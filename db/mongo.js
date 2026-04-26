require('dotenv').config();

const mongoose = require('mongoose');

function skipMongo() {
  const v = String(process.env.SKIP_MONGO || '').toLowerCase();
  return v === '1' || v === 'true' || v === 'yes';
}

const mongoDisabled = skipMongo();

function getConnectionString() {
  const host = process.env.MONGO_HOST;
  const port = process.env.MONGO_PORT;
  const db = process.env.MONGO_DB;
  return `mongodb://${host}:${port}/${db}`;
}

if (!mongoDisabled) {
  mongoose.connect(getConnectionString()).catch((err) => {
    console.error('[mongo]', err.message);
    process.exit(1);
  });
} else {
  console.warn(
    '[mongo] SKIP_MONGO=true: sin conexión a MongoDB.'
  );
}

const usuarios = mongoose.model('users', {
  id: Number,
  isAdmin: Number,
  usuario: String,
  pass: String,
  nombre: String,
  email: String,
});

module.exports = { mongoose, usuarios, mongoDisabled };
