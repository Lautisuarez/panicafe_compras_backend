require('dotenv').config();

const db_host = process.env.DB_HOST;
const db_name = process.env.DB_NAME;
const db_user = process.env.DB_USER;
const db_password = process.env.DB_PASSWORD;
const db_port = process.env.DB_PORT;

const invoice_db_host = process.env.INVOICE_DB_HOST;
const invoice_db_name = process.env.INVOICE_DB_NAME;
const invoice_db_user = process.env.INVOICE_DB_USER;
const invoice_db_password = process.env.INVOICE_DB_PASSWORD;
const invoice_db_port = process.env.INVOICE_DB_PORT;

module.exports = {
  db_host,
  db_name,
  db_user,
  db_password,
  db_port,
  invoice_db_host,
  invoice_db_name,
  invoice_db_user,
  invoice_db_password,
  invoice_db_port,
};
