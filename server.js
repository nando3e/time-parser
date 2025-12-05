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
function preprocesarExpresion(expresion, fechaReferencia, limiteSemanas = 1) {
  const normalizada = expresion.toLowerCase().trim();
  const refDate = DateTime.fromJSDate(fechaReferencia);
  
  // Calcular límite de días dinámico: días hasta domingo + (semanas * 7)
  const hoyDiaSemana = refDate.weekday; // 1=lunes, 7=domingo
  const diasHastaDomingo = 7 - hoyDiaSemana;
  const limiteDias = diasHastaDomingo + (limiteSemanas * 7);
  
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
  
  // Detectar "la semana que viene" (sin día específico) -> Forzar al Lunes de la semana siguiente (Lunes más inmediato de la próxima semana)
  // Expresiones: "la semana que viene", "la próxima semana", "la setmana que ve", "la setmana vinent", "la propera setmana"
  const matchSemanaQueVieneGen = normalizada.match(/^(?:la\s+)?(?:semana|setmana)\s+(?:que\s+(?:viene|ve)|próxima|proxima|pròxima|vinent|propera|siguiente|següent)$/i) ||
                                 normalizada.match(/^(?:la\s+)?(?:próxima|proxima|pròxima|vinent|propera|siguiente|següent)\s+(?:semana|setmana)$/i);

  if (matchSemanaQueVieneGen) {
      // Calcular días hasta el próximo lunes (siempre el inicio de la semana siguiente)
      // Fórmula: Días hasta el domingo actual + 1 día
      // Ej: Viernes(5) -> Domingo(7) son 2 días + 1 = 3 días (Viernes+3 = Lunes)
      const diasHastaProximoLunes = (7 - hoyDiaSemana) + 1;
      return refDate.plus({ days: diasHastaProximoLunes }).set({ hour: 14, minute: 0, second: 0, millisecond: 0 });
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
      // "La semana que viene" = la semana que empieza el próximo lunes
      // Calcular días hasta el próximo lunes (no siempre +7, depende del día actual)
      let diasHastaProximoLunes;
      if (hoyDiaSemana === 1) {
        // Si hoy es lunes, el próximo lunes es dentro de 7 días
        diasHastaProximoLunes = 7;
      } else {
        // Si no es lunes, calcular días hasta el próximo lunes
        diasHastaProximoLunes = 8 - hoyDiaSemana; // Ej: viernes (5) → 8-5 = 3 días
      }
      
      // Luego, sumar los días desde ese lunes hasta el día objetivo
      const diasDesdeLunes = diaObjetivo - 1; // 0=lunes, 6=domingo
      
      // Total: días hasta próximo lunes + días desde lunes hasta día objetivo
      let diasSumar = diasHastaProximoLunes + diasDesdeLunes;
      
      // Aplicar límite de días: si excede, buscar el mismo día de la semana más cercano dentro del límite
      if (diasSumar > limiteDias) {
        // Buscar el mismo día de la semana dentro del límite
        const diasHastaDiaEstaSemana = diaObjetivo - hoyDiaSemana;
        if (diasHastaDiaEstaSemana > 0 && diasHastaDiaEstaSemana <= limiteDias) {
          // El día está en esta semana dentro del límite
          diasSumar = diasHastaDiaEstaSemana;
        } else {
          // El día ya pasó esta semana o excede, buscar el más cercano dentro del límite
          if (diasHastaDiaEstaSemana <= 0) {
            // Ya pasó, buscar en la próxima semana pero limitado
            diasSumar = Math.min(limiteDias, diasHastaDiaEstaSemana + 7);
          } else {
            // Está en esta semana pero excede (no debería pasar)
            diasSumar = Math.min(diasHastaDiaEstaSemana, limiteDias);
          }
        }
      }
      
      return refDate.plus({ days: diasSumar }).set({ hour: 14, minute: 0, second: 0, millisecond: 0 });
    }
  }
  
  // Detectar "que viene" / "que ve" / "próximo" (próximo día de la semana)
  // Ejemplo: "el martes que viene", "dimarts que ve", "el próximo martes"
  const matchQueViene = normalizada.match(/(?:el\s+)?(?:próximo|proximo|pròxim|següent|siguiente)\s+(lunes|martes|miércoles|miercoles|jueves|viernes|sábado|sabado|domingo|dilluns|dimarts|dimecres|dijous|divendres|dissabte|diumenge)/i) ||
                        normalizada.match(/(?:el\s+)?(lunes|martes|miércoles|miercoles|jueves|viernes|sábado|sabado|domingo|dilluns|dimarts|dimecres|dijous|divendres|dissabte|diumenge)\s+que\s+(viene|ve)/i);
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
      
      // Aplicar límite de días
      if (diasSumar > limiteDias) {
        // Buscar el mismo día de la semana más cercano dentro del límite
        diasSumar = Math.min(diasSumar, limiteDias);
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
function validarYCorregirFecha(fecha, fechaReferencia, expresion, limiteSemanas = 1, diasExcluidos = []) {
  const refDate = DateTime.fromJSDate(fechaReferencia);
  const normalizada = expresion.toLowerCase();
  
  // Calcular límite de días dinámico: días hasta domingo + (semanas * 7)
  const hoyDiaSemana = refDate.weekday; // 1=lunes, 7=domingo
  const diasHastaDomingo = 7 - hoyDiaSemana;
  const limiteDias = diasHastaDomingo + (limiteSemanas * 7);
  
  // --- LÓGICA PARA "HOY PERO YA PASÓ LA HORA" ---
  // Si la fecha es hoy, pero la hora ya pasó, y NO especificó una fecha concreta (solo hora o "hoy")
  const esMismoDia = fecha.hasSame(refDate, 'day');
  if (esMismoDia && fecha < refDate) {
      // Verificar si especificó una fecha concreta ("hoy 28 de noviembre", "viernes 28")
      const tieneFechaEspecifica = normalizada.match(/\d+\s+(?:de\s+)?(enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|octubre|noviembre|diciembre|gener|febrer|març|abril|maig|juny|juliol|agost|setembre|octubre|novembre|desembre)/i) ||
                                   normalizada.match(/(enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|octubre|noviembre|diciembre|gener|febrer|març|abril|maig|juny|juliol|agost|setembre|octubre|novembre|desembre)\s+\d+/i);
      
      if (!tieneFechaEspecifica) {
          // Asumir que quería "a partir de ahora" o la próxima ocurrencia -> Mover a MAÑANA
          fecha = fecha.plus({ days: 1 });
      }
  }
  
  // Detectar si es un conteo de días (ej: "en 2 días", "dentro de 3 días", "pasado mañana")
  const esConteoDias = normalizada.match(/(?:en|dentro de|dins de)\s+(\d+)\s+d[ií]as?/i) ||
                       normalizada.includes('pasado mañana') ||
                       normalizada.includes('demà passat') ||
                       normalizada.match(/par\s+de\s+d[ií]as?/i);
  
  // Si la fecha es pasada
  if (fecha < refDate) {
    // Detectar si menciona una fecha específica (día + mes), ej: "28 de noviembre", "noviembre 28"
    const tieneFechaEspecifica = normalizada.match(/\d+\s+(?:de\s+)?(enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|octubre|noviembre|diciembre|gener|febrer|març|abril|maig|juny|juliol|agost|setembre|octubre|novembre|desembre)/i) ||
                                   normalizada.match(/(enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|octubre|noviembre|diciembre|gener|febrer|març|abril|maig|juny|juliol|agost|setembre|octubre|novembre|desembre)\s+\d+/i);
    
    // Detectar si menciona un día de la semana (con o sin artículo)
    // Ej: "viernes", "el viernes", "viernes 28 de noviembre"
    const esDiaSemanaEspecifico = normalizada.match(/(?:el|la|els|les)?\s*(lunes|martes|miércoles|miercoles|jueves|viernes|sábado|sabado|domingo|dilluns|dimarts|dimecres|dijous|divendres|dissabte|diumenge)/i);
    
    // Si menciona día de la semana Y la fecha ya pasó:
    // - Si tiene fecha específica → buscar el próximo día de la semana (no el próximo año)
    // - Si no tiene fecha específica → buscar el próximo día de la semana
    if (esDiaSemanaEspecifico && !esConteoDias) {
      // Para días de la semana específicos, buscar el próximo
      const diaSemana = fecha.weekday; // 1=lunes, 7=domingo
      const hoyDiaSemana = refDate.weekday;
      
      // Calcular días hasta el próximo día de la semana
      let diasSumar = diaSemana - hoyDiaSemana;
      
      if (diasSumar <= 0) {
        // Si el día ya pasó esta semana, ir al lunes de la próxima semana
        // Ejemplo: hoy miércoles (3), objetivo lunes (1)
        // Días hasta el domingo de esta semana: 7 - 3 = 4
        // Días hasta el próximo lunes (que ya es de la próxima semana): 4 + 1 = 5 días
        const diasHastaDomingo = 7 - hoyDiaSemana; // Días hasta el domingo de esta semana
        const diasHastaProximoLunes = diasHastaDomingo + 1; // Lunes de la próxima semana
        const diasDesdeLunes = diaSemana - 1; // Días desde lunes hasta el día objetivo
        diasSumar = diasHastaProximoLunes + diasDesdeLunes;
      }
      
      // Aplicar límite de días: si excede, buscar el mismo día de la semana más cercano dentro del límite
      if (diasSumar > limiteDias) {
        // Buscar el mismo día de la semana dentro del límite
        // Ejemplo: si hoy es lunes y piden "domingo de la semana que viene" (13 días)
        // pero el límite es 11, buscar el domingo más cercano dentro de 11 días
        const diasHastaProximoDia = diaSemana - hoyDiaSemana;
        if (diasHastaProximoDia > 0 && diasHastaProximoDia <= limiteDias) {
          // El día está en esta semana dentro del límite
          diasSumar = diasHastaProximoDia;
        } else {
          // Buscar el día más cercano: si está en esta semana pero ya pasó, buscar en la próxima
          // pero limitado a limiteDias días
          if (diasHastaProximoDia <= 0) {
            // Ya pasó esta semana, buscar en la próxima pero limitado
            const diasHastaDomingo = 7 - hoyDiaSemana;
            const diasHastaProximoLunes = diasHastaDomingo + 1;
            const diasDesdeLunes = diaSemana - 1;
            const diasCalculados = diasHastaProximoLunes + diasDesdeLunes;
            
            if (diasCalculados > limiteDias) {
              // Si aún excede, buscar el mismo día de esta semana (aunque ya pasó, es el más cercano dentro del límite)
              // O mejor: buscar el día más cercano dentro del límite
              diasSumar = Math.min(limiteDias, diasHastaProximoDia + 7);
            } else {
              diasSumar = diasCalculados;
            }
          } else {
            // Está en esta semana pero excede el límite (no debería pasar, pero por seguridad)
            diasSumar = Math.min(diasHastaProximoDia, limiteDias);
          }
        }
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
  
  // Validación final: si la fecha resultante excede el límite, ajustarla restando semanas
  // Esto mantiene el día de la semana correcto pero corrige saltos excesivos (ej: irse a 2026 o saltar una semana extra)
  let diasDiferencia = fecha.diff(refDate, 'days').days; // Puede tener decimales
  
  if (diasDiferencia > limiteDias) {
    // Restar semanas hasta entrar en el límite
    // Usamos un bucle de seguridad, pero matemáticamente podemos calcularlo directo
    const semanasExcedidas = Math.ceil((diasDiferencia - limiteDias) / 7);
    fecha = fecha.minus({ days: semanasExcedidas * 7 });
    
    // Recalcular diferencia para asegurar
    diasDiferencia = fecha.diff(refDate, 'days').days;
    
    // Si al restar nos fuimos al pasado (diferencia negativa), sumar 7 para quedarnos con la próxima ocurrencia futura
    // (A menos que sea "hoy" y la hora sea válida, pero Chrono suele manejar fechas futuras)
    if (diasDiferencia < 0) {
       // Verificar si es hoy (diferencia pequeña negativa por horas)
       const esMismoDia = fecha.hasSame(refDate, 'day');
       if (!esMismoDia && fecha < refDate) {
          fecha = fecha.plus({ days: 7 });
       }
    }
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
  
  // --- LÓGICA DE DÍAS EXCLUIDOS ---
  // Si la fecha cae en un día excluido, saltar al siguiente día válido
  if (diasExcluidos && diasExcluidos.length > 0) {
      let intentos = 0;
      // Mapa de días a números ISO (1=Lunes, 7=Domingo)
      const mapaDias = {
          'lunes': 1, 'martes': 2, 'miercoles': 3, 'miércoles': 3, 'jueves': 4, 'viernes': 5, 'sabado': 6, 'sábado': 6, 'domingo': 7,
          'dilluns': 1, 'dimarts': 2, 'dimecres': 3, 'dijous': 4, 'divendres': 5, 'dissabte': 6, 'diumenge': 7,
          'lun': 1, 'mar': 2, 'mie': 3, 'mié': 3, 'jue': 4, 'vie': 5, 'sab': 6, 'sáb': 6, 'dom': 7,
          'dl': 1, 'dt': 2, 'dc': 3, 'dj': 4, 'dv': 5, 'ds': 6, 'dg': 7,
          '1': 1, '2': 2, '3': 3, '4': 4, '5': 5, '6': 6, '7': 7
      };

      // Normalizar días excluidos a números
      const excluidosNumeros = diasExcluidos.map(d => {
          const dNorm = d.toString().toLowerCase().trim();
          return mapaDias[dNorm] || parseInt(dNorm, 10);
      }).filter(n => !isNaN(n));

      // Bucle para saltar días excluidos (máximo 14 días para evitar bucles infinitos)
      while (intentos < 14) {
          const diaSemanaActual = fecha.weekday;
          if (excluidosNumeros.includes(diaSemanaActual)) {
              // Si es excluido, sumar 1 día
              fecha = fecha.plus({ days: 1 });
              intentos++;
          } else {
              // Día válido encontrado
              break;
          }
      }
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
  const { referencia, expresion_usuario, zona_horaria = "Europe/Madrid", limite_semanas = 1, dias_excluidos = [] } = req.body;
  
  const debug_info = []; // Array para traza de resolución

  try {
    // Validar inputs
    if (!expresion_usuario) {
      return res.status(400).json({ error: true, mensaje: "Falta el parámetro 'expresion_usuario'." });
    }
    
    // Si es solo un saludo o irrelevante, devolver error o null
    if (!esExpresionTemporalClara(expresion_usuario)) {
      debug_info.push("Expresión no identificada como temporal clara.");
      return res.status(200).json({
        fecha_resuelta: "sin_definir",
        dia_semana: "sin_definir",
        hora: "sin_definir",
        iso_datetime: "sin_definir",
        es_finde: false,
        es_pasado: false,
        debug_info
      });
    }
    
    // Referencia temporal (ahora)
    let refDate = DateTime.now().setZone(zona_horaria);
    if (referencia) {
      // Validar formato ISO básico
      if (referencia.match(/^\d{4}-\d{2}-\d{2}/)) {
         // Intentar parsear con ISO
         const tempRef = DateTime.fromISO(referencia, { zone: zona_horaria });
         if (tempRef.isValid) {
           refDate = tempRef;
         } else {
           return res.status(400).json({ error: true, mensaje: "Referencia inválida." });
         }
      } else {
         return res.status(400).json({ error: true, mensaje: "Referencia inválida." });
      }
    }

    // Convertir limite_semanas a número
    const limiteSemanas = parseInt(limite_semanas, 10) || 1;
    
    // Procesar dias_excluidos (puede venir como string separado por comas o array)
    let diasExcluidos = [];
    if (typeof dias_excluidos === 'string') {
      diasExcluidos = dias_excluidos.split(',').map(d => d.trim());
    } else if (Array.isArray(dias_excluidos)) {
      diasExcluidos = dias_excluidos;
    }
    
    debug_info.push(`Referencia: ${refDate.toISO()}, Zona: ${zona_horaria}`);
    debug_info.push(`Expresión recibida: "${expresion_usuario}"`);

    // Preprocesar expresiones especiales (pasado mañana, demà passat, etc.)
    const preprocesado = preprocesarExpresion(expresion_usuario, refDate.toJSDate(), limiteSemanas);
    let fecha;
    
    if (preprocesado) {
      // Si el preprocesador encontró una expresión especial, usar ese resultado
      fecha = preprocesado;
      debug_info.push("Resuelto por PREPROCESADOR (Regla estricta/especial detectada).");
    } else {
      // Detectar idioma y parsear con Chrono
      const idioma = detectarIdioma(expresion_usuario);
      debug_info.push(`Idioma detectado: ${idioma}`);
      
      const refDateJS = refDate.toJSDate();
      
      let parsed = null;
      
      // Intentar primero con el idioma detectado
      if (idioma === 'ca') {
        // Chrono no tiene soporte nativo para catalán
        // Primero intentamos directamente (algunas expresiones son similares)
        parsed = chrono.es.parseDate(expresion_usuario, refDateJS);
        
        // Si falla, intentar con traducciones manuales básicas
        if (!parsed) {
          debug_info.push("Chrono directo falló para CA, intentando traducción manual básica.");
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
            debug_info.push(`Traducción manual aplicada: "${expresionTraducida}"`);
            parsed = chrono.es.parseDate(expresionTraducida, refDateJS);
          }
        }
        
        // Si aún falla y tenemos OpenAI, traducir con el modelo
        if (!parsed && openai) {
          debug_info.push("Traducción manual falló, usando OpenAI para traducir.");
          const traduccion = await traducirCatalanaEspanol(expresion_usuario);
          if (traduccion) {
            debug_info.push(`Traducción OpenAI: "${traduccion}"`);
            parsed = chrono.es.parseDate(traduccion, refDateJS);
          }
        }
      } else {
        // Español: usar parser nativo
        parsed = chrono.es.parseDate(expresion_usuario, refDateJS);
      }
      
      if (!parsed) {
        // Si Chrono falla, intentar con OpenAI como fallback (si está configurado)
        debug_info.push("Chrono no pudo resolver. Intentando Fallback OpenAI.");
        const fechaOpenAI = await parsearConOpenAI(expresion_usuario, refDateJS, zona_horaria);
        
        if (fechaOpenAI === 'sin_definir') {
          debug_info.push("OpenAI devolvió 'sin_definir'.");
          return res.status(200).json({
            fecha_resuelta: "sin_definir",
            dia_semana: "sin_definir",
            hora: "sin_definir",
            iso_datetime: "sin_definir",
            es_finde: false,
            es_pasado: false,
            debug_info
          });
        }
        
        if (fechaOpenAI) {
          fecha = fechaOpenAI;
          debug_info.push("Resuelto por OpenAI Fallback.");
        } else {
          debug_info.push("Error: No se pudo interpretar la fecha tras todos los intentos.");
          return res.status(200).json({
            error: true,
            mensaje: "No se pudo interpretar la fecha.",
            debug_info
          });
        }
      } else {
        fecha = DateTime.fromJSDate(parsed, { zone: zona_horaria });
        debug_info.push("Resuelto por CHRONO.");
        
        // Validar y corregir la fecha según reglas de negocio
        const fechaOriginal = fecha;
        fecha = validarYCorregirFecha(fecha, refDateJS, expresion_usuario, limiteSemanas, diasExcluidos);
        if (fecha.toMillis() !== fechaOriginal.toMillis()) {
             debug_info.push("Fecha ajustada por validaciones (días excluidos, hora pasada, etc).");
        }
        
        // DOBLE CHECK: Si después de validar sigue siendo pasada y tenemos OpenAI, intentar con LLM
        if (fecha < refDate && openai) {
          debug_info.push("Fecha resultante es pasada. Intentando corrección con OpenAI.");
          const fechaOpenAI = await parsearConOpenAI(expresion_usuario, refDateJS, zona_horaria);
          if (fechaOpenAI === 'sin_definir') {
            // Si OpenAI dice sin_definir, mantener la fecha parseada (aunque sea pasada)
            // El usuario puede decidir qué hacer con ella
          } else if (fechaOpenAI && fechaOpenAI >= refDate) {
            fecha = fechaOpenAI;
            debug_info.push("Corrección OpenAI aplicada (fecha futura encontrada).");
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
      es_pasado,
      debug_info
    };

    res.status(200).json(response);

  } catch (err) {
    debug_info.push(`Excepción capturada: ${err.message}`);
    res.status(500).json({
      error: true,
      mensaje: err.message,
      debug_info
    });
  }
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => console.log(`🧩 RBP Time Parser running on port ${PORT}`));
