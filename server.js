import express from "express";
import { DateTime } from "luxon";
import * as chrono from "chrono-node";

const app = express();
app.use(express.json());

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

app.post("/parse-fecha", (req, res) => {
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

    // Parseo con Chrono
    const parsed = chrono.es.parseDate(expresion_usuario, refDate.toJSDate());
    if (!parsed) {
      return res.status(200).json({
        error: true,
        mensaje: "No se pudo interpretar la fecha.",
      });
    }

    const fecha = DateTime.fromJSDate(parsed, { zone: zona_horaria });
    const dia_semana = fecha.setLocale("es").toFormat("cccc");
    const es_finde = ["sábado", "domingo"].includes(dia_semana.toLowerCase());
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
