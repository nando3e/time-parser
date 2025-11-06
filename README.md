# 🧩 RBP Time Parser

Microservicio determinista para interpretar expresiones temporales en lenguaje natural  
(“mañana”, “el viernes a las 7”, “la semana que viene”, etc.)  
Retorna siempre fechas coherentes, en formato ISO 8601 y ajustadas a la zona horaria.

---

## 🚀 Uso rápido

```bash
git clone https://github.com/tuusuario/rbp-time-parser.git
cd rbp-time-parser
docker compose up -d
```

Servicio accesible en:
```
http://localhost:8080/parse-fecha
```
o en producción:
```
https://time.rbimprove.app/parse-fecha
```

---

## 📤 Ejemplo de request

```bash
curl -X POST https://time.rbimprove.app/parse-fecha \
  -H "Content-Type: application/json" \
  -d '{
    "referencia": "2025-11-04T09:00:00+01:00",
    "expresion_usuario": "el viernes a las 7",
    "zona_horaria": "Europe/Madrid"
  }'
```

---

## 📥 Respuesta

```json
{
  "fecha_resuelta": "2025-11-07",
  "dia_semana": "viernes",
  "hora": "19:00",
  "iso_datetime": "2025-11-07T19:00:00+01:00",
  "es_finde": false,
  "es_pasado": false
}
```

---

## 🧠 Internamente usa
- **chrono-node** para interpretar expresiones naturales.
- **Luxon** para validación, formato y zona horaria.
- Reglas deterministas para evitar errores de calendario o fechas pasadas.

---

## 🧱 Integración con n8n

Nodo HTTP Request (POST):
```
URL: https://time.rbimprove.app/parse-fecha
Body: 
{
  "referencia": "={{ $now }}",
  "expresion_usuario": "={{ $json.content }}",
  "zona_horaria": "Europe/Madrid"
}
```

Recibirás en output:
```
fecha_resuelta, dia_semana, hora, iso_datetime, es_finde, es_pasado
```

---

## 🔒 Seguridad opcional
Puedes habilitar una API key añadiendo:

```js
app.use((req, res, next) => {
  if (req.headers["x-api-key"] !== process.env.API_KEY) return res.status(403).send("Forbidden");
  next();
});
```

Y configurar en Docker Compose:
```
environment:
  - API_KEY=mi_clave_segura
```

---

## 🧩 Licencia
Uso interno RBP · Propósito: automatización y determinismo temporal.
