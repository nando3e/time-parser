import express from "express";
import { DateTime } from "luxon";
import * as chrono from "chrono-node";
import OpenAI from "openai";

const app = express();
app.use(express.json());

// Inicializar OpenAI solo si hay API key (opcional)
const openai = process.env.OPENAI_API_KEY 
  ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
  : null;
const OPENAI_MODEL = process.env.OPENAI_MODEL || "gpt-4o-mini";

/**
 * Preprocesa expresiones problemáticas antes de pasar a Chrono
 * Maneja casos como "pasado mañana" que Chrono no entiende bien
 */
function preprocesarExpresion(expresion, fechaReferencia) {
  const normalizada = expresion.toLowerCase().trim();
  const refDate = DateTime.fromJSDate(fechaReferencia);
  
  // Expresiones con hora (español)
  const matchPasadoMananaHora = expresion.match(/pasado\s+mañana\s+a\s+las\s+(\d+)/i);
  if (matchPasadoMananaHora) {
    const horaNum = parseInt(matchPasadoMananaHora[1]);
    return refDate.plus({ days: 2 }).set({ hour: horaNum, minute: 0, second: 0, millisecond: 0 });
  }
  
  // Expresiones con hora (catalán)
  const matchDemaPassatHora = expresion.match(/demà\s+passat\s+a\s+les\s+(\d+)/i);
  if (matchDemaPassatHora) {
    const horaNum = parseInt(matchDemaPassatHora[1]);
    return refDate.plus({ days: 2 }).set({ hour: horaNum, minute: 0, second: 0, millisecond: 0 });
  }
  
  // Expresiones simples
  if (normalizada.includes('pasado mañana') || normalizada.includes('demà passat')) {
    return refDate.plus({ days: 2 });
  }
  
  // Detectar "de la semana que viene/próxima/vinent/propera" (forzar próxima semana)
  // Ejemplo: "el viernes de la semana que viene", "divendres de la setmana vinent", "viernes próxima semana"
  const matchSemanaQueViene1 = normalizada.match(/(?:el\s+)?(lunes|martes|miércoles|miercoles|jueves|viernes|sábado|sabado|domingo|dilluns|dimarts|dimecres|dijous|divendres|dissabte|diumenge)\s+(?:de\s+la\s+)?(?:semana|setmana)\s+(?:que\s+(?:viene|ve)|próxima|proxima|pròxima|vinent|propera|siguiente|següent)/i);
  const matchSemanaQueViene2 = normalizada.match(/(?:el\s+)?(lunes|martes|miércoles|miercoles|jueves|viernes|sábado|sabado|domingo|dilluns|dimarts|dimecres|dijous|divendres|dissabte|diumenge)\s+(?:próxima|proxima|pròxima|vinent|propera|siguiente|següent)\s+(?:semana|setmana)/i);
  const matchSemanaQueViene = matchSemanaQueViene1 || matchSemanaQueViene2;
  
  if (matchSemanaQueViene) {
    const diasSemana = {
      'lunes': 1, 'martes': 2, 'miércoles': 3, 'miercoles': 3, 'jueves': 4, 'viernes': 5, 'sábado': 6, 'sabado': 6, 'domingo': 7,
      'dilluns': 1, 'dimarts': 2, 'dimecres': 3, 'dijous': 4, 'divendres': 5, 'dissabte': 6, 'diumenge': 7
    };
    
    const diaObjetivo = diasSemana[matchSemanaQueViene[1].toLowerCase()];
    const hoyDiaSemana = refDate.weekday; // 1=lunes, 7=domingo
    
    if (diaObjetivo) {
      // Calcular días hasta ese día de la PRÓXIMA semana
      // Primero, calcular cuántos días hasta el lunes de la próxima semana
      const diasHastaLunesProxima = (8 - hoyDiaSemana) % 7 || 7; // Días hasta el próximo lunes
      
      // Luego, sumar los días desde el lunes hasta el día objetivo
      const diasDesdeLunes = (diaObjetivo - 1) % 7; // 0=lunes, 6=domingo
      
      // Total: días hasta lunes próxima semana + días desde lunes hasta día objetivo
      const diasSumar = diasHastaLunesProxima + diasDesdeLunes;
      
      return refDate.plus({ days: diasSumar }).set({ hour: 14, minute: 0, second: 0, millisecond: 0 });
    }
  }
  
  // Detectar "que viene" / "que ve" (próximo día de la semana)
  // Ejemplo: "el martes que viene", "dimarts que ve"
  const matchQueViene = normalizada.match(/(?:el\s+)?(lunes|martes|miércoles|miercoles|jueves|viernes|sábado|sabado|domingo|dilluns|dimarts|dimecres|dijous|divendres|dissabte|diumenge)\s+que\s+(viene|ve)/i);
  if (matchQueViene) {
    const diasSemana = {
      'lunes': 1, 'martes': 2, 'miércoles': 3, 'miercoles': 3, 'jueves': 4, 'viernes': 5, 'sábado': 6, 'sabado': 6, 'domingo': 7,
      'dilluns': 1, 'dimarts': 2, 'dimecres': 3, 'dijous': 4, 'divendres': 5, 'dissabte': 6, 'diumenge': 7
    };
    
    const diaObjetivo = diasSemana[matchQueViene[1].toLowerCase()];
    const hoyDiaSemana = refDate.weekday; // 1=lunes, 7=domingo
    
    if (diaObjetivo) {
      // Calcular días hasta el próximo día de la semana
      let diasSumar = diaObjetivo - hoyDiaSemana;
      if (diasSumar <= 0) {
        diasSumar += 7; // Próxima semana
      }
      
      // Saltar fines de semana si hoy es viernes
      if (hoyDiaSemana === 5 && diasSumar <= 2) {
        diasSumar = 3; // Saltar a lunes
      }
      
      return refDate.plus({ days: diasSumar }).set({ hour: 14, minute: 0, second: 0, millisecond: 0 });
    }
  }
  
  return null; // Dejar que Chrono lo maneje
}

/**
 * Valida y corrige una fecha parseada según las reglas de negocio
 * - Nunca usar fechas pasadas (solo para días de la semana específicos)
 * - NO saltar fines de semana en conteo de días (ej: "en 2 días" incluye sábado/domingo)
 * - Aplicar reglas de hora por defecto básicas
 */
function validarYCorregirFecha(fecha, fechaReferencia, expresion) {
  const refDate = DateTime.fromJSDate(fechaReferencia);
  const normalizada = expresion.toLowerCase();
  
  // Detectar si es un conteo de días (ej: "en 2 días", "dentro de 3 días", "pasado mañana")
  const esConteoDias = normalizada.match(/(?:en|dentro de|dins de)\s+(\d+)\s+d[ií]as?/i) ||
                       normalizada.includes('pasado mañana') ||
                       normalizada.includes('demà passat') ||
                       normalizada.match(/par\s+de\s+d[ií]as?/i);
  
  // Si la fecha es pasada
  if (fecha < refDate) {
    // Si es un día de la semana específico (ej: "el martes"), buscar el próximo
    const esDiaSemanaEspecifico = normalizada.match(/(?:el|la|els|les)\s+(lunes|martes|miércoles|jueves|viernes|sábado|domingo|dilluns|dimarts|dimecres|dijous|divendres|dissabte|diumenge)/i);
    
    if (esDiaSemanaEspecifico && !esConteoDias) {
      // Para días de la semana específicos, buscar el próximo
      const diaSemana = fecha.weekday; // 1=lunes, 7=domingo
      const hoyDiaSemana = refDate.weekday;
      
      // Calcular días hasta el próximo día de la semana
      let diasSumar = diaSemana - hoyDiaSemana;
      if (diasSumar <= 0) {
        diasSumar += 7; // Próxima semana
      }
      
      fecha = refDate.plus({ days: diasSumar }).set({
        hour: fecha.hour,
        minute: fecha.minute,
        second: 0,
        millisecond: 0
      });
    }
    // Si es conteo de días, NO corregir (dejar que incluya fines de semana)
  }
  
  // Reglas de hora por defecto básicas
  // Si no tiene hora específica, asumir mediodía (12:00) - más genérico
  if (fecha.hour === 0 && fecha.minute === 0 && !normalizada.match(/\d+\s*(h|horas?|hrs?|m|minutos?)/i)) {
    fecha = fecha.set({ hour: 12, minute: 0 });
  }
  
  // Si dice "a las 7" sin especificar AM/PM, asumir 19:00 (pero solo si es explícito)
  const matchHora7 = normalizada.match(/a\s+(las?|les?)\s+7\b/i);
  if (matchHora7 && fecha.hour === 7 && !normalizada.match(/7\s*(am|a\.m\.|de la mañana)/i)) {
    fecha = fecha.set({ hour: 19 });
  }
  
  return fecha;
}

/**
 * Detecta si la expresión contiene información temporal clara
 * Si SOLO es un saludo sin información temporal adicional, devuelve false
 * Si tiene saludo PERO también información temporal, devuelve true
 */
function esExpresionTemporalClara(expresion) {
  const normalizada = expresion.toLowerCase().trim();
  
  // Palabras clave temporales (días, fechas, horas, etc.)
  const palabrasTemporales = [
    'hoy', 'mañana', 'pasado', 'ayer', 'avui', 'demà', 'ahir',
    'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado', 'sabado', 'domingo',
    'dilluns', 'dimarts', 'dimecres', 'dijous', 'divendres', 'dissabte', 'diumenge',
    'semana', 'mes', 'año', 'setmana', 'any',
    'día', 'dias', 'dia', 'dies',
    'hora', 'horas', 'hora', 'hores',
    'minuto', 'minutos', 'minut', 'minuts',
    'que viene', 'que ve', 'próximo', 'proximo', 'pròxim',
    'dentro de', 'dins de', 'en', 'a las', 'a les', 'las', 'les',
    'par de', 'parell de', 'cuando', 'quan'
  ];
  
  // Verificar si tiene palabras temporales
  const tieneTemporal = palabrasTemporales.some(palabra => normalizada.includes(palabra));
  
  // Si tiene información temporal, siempre es clara (aunque tenga saludo)
  if (tieneTemporal) {
    return true;
  }
  
  // Saludos comunes que SOLO son saludos (sin información temporal)
  const soloSaludos = [
    'hola', 'buenos días', 'buenos dias', 'buenas tardes', 'buenas noches',
    'bon dia', 'bona tarda', 'bona nit', 'adeu', 'adios', 'hasta luego',
    'gracias', 'gràcies', 'de nada', 'per favor', 'por favor', 'si', 'no',
    'ok', 'vale', 'perfecto', 'perfecte'
  ];
  
  // Si es EXACTAMENTE un saludo sin nada más, no es clara
  const esSoloSaludo = soloSaludos.some(saludo => {
    const saludoLower = saludo.toLowerCase();
    // Coincidencia exacta o saludo seguido solo de puntuación/espacios
    return normalizada === saludoLower || 
           normalizada === saludoLower + '.' ||
           normalizada === saludoLower + '!' ||
           normalizada === saludoLower + '?';
  });
  
  // Si es solo saludo sin temporal, no es clara
  if (esSoloSaludo) {
    return false;
  }
  
  // Si no tiene temporal pero tampoco es solo saludo, intentar parsear (puede tener números, fechas, etc.)
  // Dejamos que Chrono/OpenAI lo intente
  return true;
}

/**
 * Detecta el idioma de la expresión (español o catalán)
 */
function detectarIdioma(expresion) {
  const normalizada = expresion.toLowerCase();
  
  // Palabras clave en catalán
  const palabrasCatalanas = [
    'demà', 'avui', 'ahir', 'setmana', 'mes', 'any',
    'dilluns', 'dimarts', 'dimecres', 'dijous', 'divendres', 'dissabte', 'diumenge',
    'gener', 'febrer', 'març', 'abril', 'maig', 'juny', 'juliol',
    'agost', 'setembre', 'octubre', 'novembre', 'desembre'
  ];
  
  const tieneCatalan = palabrasCatalanas.some(palabra => normalizada.includes(palabra));
  
  return tieneCatalan ? 'ca' : 'es';
}

/**
 * Traduce una expresión en catalán a español usando OpenAI
 */
async function traducirCatalanaEspanol(expresion) {
  if (!openai) {
    return null;
  }

  try {
    const completion = await openai.chat.completions.create({
      model: OPENAI_MODEL,
      messages: [
        {
          role: "system",
          content: "Eres un traductor experto de catalán a español. Traduce SOLO expresiones temporales manteniendo el mismo significado. Responde SOLO con la traducción, sin explicaciones."
        },
        {
          role: "user",
          content: `Traduce esta expresión temporal de catalán a español: "${expresion}"\n\nTraducción:`
        }
      ],
      temperature: 0.1,
      max_tokens: 100
    });

    const traduccion = completion.choices[0]?.message?.content?.trim();
    return traduccion ? traduccion.replace(/['"]/g, '').trim() : null;
  } catch (error) {
    console.error("Error al traducir con OpenAI:", error.message);
    return null;
  }
}

/**
 * Usa OpenAI como fallback para parsear expresiones que Chrono no entiende
 * Traduce la expresión a una fecha ISO 8601
 */
async function parsearConOpenAI(expresion, fechaReferencia, zonaHoraria) {
  if (!openai) {
    return null; // OpenAI no configurado
  }

  try {
    const refDate = DateTime.fromJSDate(fechaReferencia, { zone: zonaHoraria });
    const fechaRefISO = refDate.toISO();
    
    const prompt = `Eres un experto en interpretar expresiones temporales en español y catalán.

Fecha de referencia (HOY): ${fechaRefISO}
Zona horaria: ${zonaHoraria}
Expresión del usuario: "${expresion}"

REGLAS OBLIGATORIAS:
1. NUNCA uses una fecha pasada. Si la expresión se refiere a un día de la semana que ya pasó, busca el PRÓXIMO ocurrencia.
2. NO saltar fines de semana en conteo de días: Si dice "en 2 días", "dentro de 3 días", "pasado mañana", etc., CUENTA todos los días incluyendo sábados y domingos.
3. Hora por defecto: Si no se especifica hora, asume MEDIODÍA (12:00) - más genérico.
4. "A las 7" sin AM/PM = 19:00 (7 PM) por defecto.
5. Para expresiones como "el martes que viene", "dimarts que ve", etc., SIEMPRE busca el PRÓXIMO martes desde hoy, nunca el pasado.
6. **PRÓXIMA SEMANA es CRÍTICO**: Si la expresión menciona "próxima semana", "semana que viene", "setmana vinent", "setmana propera", "siguiente semana", etc., el día mencionado DEBE ser de la PRÓXIMA semana (mínimo +7 días desde hoy), NO de esta semana. Ejemplos:
   - "viernes de la próxima semana" = viernes de la semana siguiente (mínimo +7 días)
   - "divendres de la setmana vinent" = viernes de la semana siguiente (mínimo +7 días)
   - "martes próxima semana" = martes de la semana siguiente (mínimo +7 días)
7. Si la expresión NO contiene información temporal clara (solo saludos, etc.), responde con "sin_definir".

Tu tarea: Interpreta la expresión y devuelve SOLO la fecha y hora en formato ISO 8601 (ejemplo: 2025-01-15T14:30:00+01:00).
Si no hay información temporal clara, responde SOLO con "sin_definir".
Responde SOLO con la fecha ISO o "sin_definir", sin explicaciones, sin texto adicional.

Fecha ISO:`;

    const completion = await openai.chat.completions.create({
      model: OPENAI_MODEL,
      messages: [
        {
          role: "system",
          content: "Eres un experto en interpretar fechas. Responde SOLO con fechas en formato ISO 8601."
        },
        {
          role: "user",
          content: prompt
        }
      ],
      temperature: 0.1, // Bajo para más determinismo
      max_tokens: 50
    });

    const fechaISO = completion.choices[0]?.message?.content?.trim();
    
    if (!fechaISO || fechaISO.toLowerCase() === 'sin_definir') {
      return 'sin_definir';
    }

    // Limpiar la respuesta (puede venir con comillas o espacios)
    const fechaLimpia = fechaISO.replace(/['"]/g, '').trim();
    const fechaParsed = DateTime.fromISO(fechaLimpia, { zone: zonaHoraria });
    
    if (fechaParsed.isValid) {
      return fechaParsed;
    }

    return null;
  } catch (error) {
    console.error("Error al usar OpenAI como fallback:", error.message);
    return null;
  }
}

app.get("/", (req, res) => {
  res.json({
    status: "ok",
    service: "RBP Time Parser",
    version: "1.0.0"
  });
});

app.get("/health", (req, res) => {
  res.status(200).json({
    status: "ok",
    service: "RBP Time Parser",
    timestamp: new Date().toISOString()
  });
});

app.post("/parse-fecha", async (req, res) => {
  const { referencia, expresion_usuario, zona_horaria = "Europe/Madrid" } = req.body;

  try {
    if (!referencia || !expresion_usuario) {
      return res.status(400).json({
        error: true,
        mensaje: "Faltan parámetros requeridos: referencia y expresion_usuario."
      });
    }

    // Verificar si la expresión tiene información temporal clara
    if (!esExpresionTemporalClara(expresion_usuario)) {
      return res.status(200).json({
        fecha_resuelta: "sin_definir",
        dia_semana: "sin_definir",
        hora: "sin_definir",
        iso_datetime: "sin_definir",
        es_finde: false,
        es_pasado: false
      });
    }

    // Fecha de referencia actual
    const refDate = DateTime.fromISO(referencia, { zone: zona_horaria });
    if (!refDate.isValid) {
      return res.status(400).json({ error: true, mensaje: "Referencia inválida." });
    }

    // Preprocesar expresiones especiales (pasado mañana, demà passat, etc.)
    const preprocesado = preprocesarExpresion(expresion_usuario, refDate.toJSDate());
    let fecha;
    
    if (preprocesado) {
      // Si el preprocesador encontró una expresión especial, usar ese resultado
      fecha = preprocesado;
    } else {
      // Detectar idioma y parsear con Chrono
      const idioma = detectarIdioma(expresion_usuario);
      const refDateJS = refDate.toJSDate();
      
      let parsed = null;
      
      // Intentar primero con el idioma detectado
      if (idioma === 'ca') {
        // Chrono no tiene soporte nativo para catalán
        // Primero intentamos directamente (algunas expresiones son similares)
        parsed = chrono.es.parseDate(expresion_usuario, refDateJS);
        
        // Si falla, intentar con traducciones manuales básicas
        if (!parsed) {
          const traducciones = {
            'dilluns': 'lunes', 'dimarts': 'martes', 'dimecres': 'miércoles',
            'dijous': 'jueves', 'divendres': 'viernes', 'dissabte': 'sábado', 'diumenge': 'domingo',
            'avui': 'hoy', 'demà': 'mañana', 'ahir': 'ayer',
            'setmana': 'semana', 'mes': 'mes', 'any': 'año'
          };
          
          let expresionTraducida = expresion_usuario;
          for (const [cat, esp] of Object.entries(traducciones)) {
            expresionTraducida = expresionTraducida.replace(
              new RegExp(cat, 'gi'), 
              esp
            );
          }
          
          if (expresionTraducida !== expresion_usuario) {
            parsed = chrono.es.parseDate(expresionTraducida, refDateJS);
          }
        }
        
        // Si aún falla y tenemos OpenAI, traducir con el modelo
        if (!parsed && openai) {
          const traduccion = await traducirCatalanaEspanol(expresion_usuario);
          if (traduccion) {
            parsed = chrono.es.parseDate(traduccion, refDateJS);
          }
        }
      } else {
        // Español: usar parser nativo
        parsed = chrono.es.parseDate(expresion_usuario, refDateJS);
      }
      
      if (!parsed) {
        // Si Chrono falla, intentar con OpenAI como fallback (si está configurado)
        const fechaOpenAI = await parsearConOpenAI(expresion_usuario, refDateJS, zona_horaria);
        
        if (fechaOpenAI === 'sin_definir') {
          return res.status(200).json({
            fecha_resuelta: "sin_definir",
            dia_semana: "sin_definir",
            hora: "sin_definir",
            iso_datetime: "sin_definir",
            es_finde: false,
            es_pasado: false
          });
        }
        
        if (fechaOpenAI) {
          fecha = fechaOpenAI;
        } else {
          return res.status(200).json({
            error: true,
            mensaje: "No se pudo interpretar la fecha.",
          });
        }
      } else {
        fecha = DateTime.fromJSDate(parsed, { zone: zona_horaria });
        
        // Validar y corregir la fecha según reglas de negocio
        fecha = validarYCorregirFecha(fecha, refDateJS, expresion_usuario);
        
        // DOBLE CHECK: Si después de validar sigue siendo pasada y tenemos OpenAI, intentar con LLM
        if (fecha < refDate && openai) {
          const fechaOpenAI = await parsearConOpenAI(expresion_usuario, refDateJS, zona_horaria);
          if (fechaOpenAI === 'sin_definir') {
            // Si OpenAI dice sin_definir, mantener la fecha parseada (aunque sea pasada)
            // El usuario puede decidir qué hacer con ella
          } else if (fechaOpenAI && fechaOpenAI >= refDate) {
            fecha = fechaOpenAI;
          }
        }
      }
    }

    // Detectar idioma para el formato del día de la semana
    const idioma = detectarIdioma(expresion_usuario);
    const locale = idioma === 'ca' ? 'ca' : 'es';
    const dia_semana = fecha.setLocale(locale).toFormat("cccc");
    
    // Días de fin de semana en ambos idiomas
    const diasFinde = idioma === 'ca' 
      ? ["dissabte", "diumenge", "sábado", "domingo"] 
      : ["sábado", "domingo"];
    const es_finde = diasFinde.some(dia => dia_semana.toLowerCase().includes(dia.toLowerCase()));
    const es_pasado = fecha < refDate;

    // Respuesta normalizada
    const response = {
      fecha_resuelta: fecha.toFormat("yyyy-MM-dd"),
      dia_semana,
      hora: fecha.toFormat("HH:mm"),
      iso_datetime: fecha.toISO(),
      es_finde,
      es_pasado
    };

    res.status(200).json(response);

  } catch (err) {
    res.status(500).json({
      error: true,
      mensaje: err.message
    });
  }
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => console.log(`🧩 RBP Time Parser running on port ${PORT}`));
