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
 * - Nunca usar fechas pasadas
 * - Saltar fines de semana si es necesario
 * - Aplicar reglas de hora por defecto
 */
function validarYCorregirFecha(fecha, fechaReferencia, expresion) {
  const refDate = DateTime.fromJSDate(fechaReferencia);
  const normalizada = expresion.toLowerCase();
  
  // Si la fecha es pasada, buscar la próxima ocurrencia
  if (fecha < refDate) {
    // Si es un día de la semana, buscar el próximo
    const diaSemana = fecha.weekday; // 1=lunes, 7=domingo
    const hoyDiaSemana = refDate.weekday;
    
    // Calcular días hasta el próximo día de la semana
    let diasSumar = diaSemana - hoyDiaSemana;
    if (diasSumar <= 0) {
      diasSumar += 7; // Próxima semana
    }
    
    // Saltar fines de semana si hoy es viernes y el objetivo es antes del lunes
    if (hoyDiaSemana === 5 && diasSumar <= 2) { // Viernes
      diasSumar = 3; // Saltar a lunes
    }
    
    fecha = refDate.plus({ days: diasSumar }).set({
      hour: fecha.hour,
      minute: fecha.minute,
      second: 0,
      millisecond: 0
    });
  }
  
  // Reglas de hora por defecto
  // Si no tiene hora específica, asumir tarde (14:00)
  if (fecha.hour === 0 && fecha.minute === 0 && !normalizada.match(/\d+\s*(h|horas?|hrs?|m|minutos?)/i)) {
    fecha = fecha.set({ hour: 14, minute: 0 });
  }
  
  // Si dice "a las 7" sin especificar AM/PM, asumir 19:00
  const matchHora7 = normalizada.match(/a\s+(las?|les?)\s+7\b/i);
  if (matchHora7 && fecha.hour === 7) {
    fecha = fecha.set({ hour: 19 });
  }
  
  // Solo viernes: horario de mañana válido (10:00-13:00)
  // Si es otro día y está en horario de mañana, mover a tarde
  if (fecha.weekday !== 5 && fecha.hour >= 10 && fecha.hour < 14) {
    fecha = fecha.set({ hour: 14 });
  }
  
  return fecha;
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
1. NUNCA uses una fecha pasada. Si la expresión se refiere a un día que ya pasó, busca el PRÓXIMO ocurrencia.
2. Saltar fines de semana: Si hoy es viernes y la expresión se refiere a mañana o pasado mañana, significa LUNES.
3. Hora por defecto: Si no se especifica "mañana" o "tarde", asume TARDE (14:00).
4. "A las 7" sin AM/PM = 19:00 (7 PM).
5. Solo los VIERNES es válido el horario de mañana (10:00-13:00). Otros días, si está en ese rango, muévelo a 14:00.
6. Para expresiones como "el martes que viene", "dimarts que ve", etc., SIEMPRE busca el PRÓXIMO martes desde hoy, nunca el pasado.

Tu tarea: Interpreta la expresión y devuelve SOLO la fecha y hora en formato ISO 8601 (ejemplo: 2025-01-15T14:30:00+01:00).
Responde SOLO con la fecha ISO, sin explicaciones, sin texto adicional.

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
    
    if (!fechaISO) {
      return null;
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
          if (fechaOpenAI && fechaOpenAI >= refDate) {
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
