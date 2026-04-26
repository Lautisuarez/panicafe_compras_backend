# Panicafe Compras — Backend

API Express para el carrito de compras.

## Requisitos

- **Node.js** `>= 20` y `< 23`.

Con nvm:

```bash
nvm install 20
nvm use 20
```

## Instalación

```bash
npm install
```

## Cómo levantar el proyecto

**Producción / ejecución simple** (sin recarga al guardar):

```bash
npm start
```

Por defecto escucha en el puerto **3001** (o el definido en la variable de entorno `PORT`).

**Desarrollo** (recarga con nodemon):

```bash
npm run dev
```

## Variables de entorno

Creá un archivo `.env` en la raíz del backend (cargado con `dotenv`). Ejemplos:

### SQL Server

| Variable | Descripción |
|----------|-------------|
| `DB_HOST` | Host del servidor SQL (si está vacío y no usás `SKIP_SQL`, la capa SQL queda deshabilitada) |
| `DB_NAME` | Nombre de la base |
| `DB_USER` / `DB_PASSWORD` | Credenciales |
| `DB_PORT` | Puerto TCP (por defecto `1433`; misma idea que DBeaver: `serverName` + `port`) |

### MongoDB

| Variable | Descripción |
|----------|-------------|
| `MONGO_URI` o `MONGODB_URI` o `DATABASE_URL` | URI completa (prioridad sobre host/puerto) |
| `MONGO_HOST` / `MONGO_PORT` / `MONGO_DB` | Si no hay URI explícita |
| `SKIP_MONGO` | `true` — no conectar a Mongo (algunas funciones de facturas pueden limitarse) |

### Otros

| Variable | Descripción |
|----------|-------------|
| `PORT` | Puerto HTTP del servidor (default `3001`) |

## Documentación HTTP

Con el servidor en marcha:

- Swagger UI: `http://localhost:3001/docs`
