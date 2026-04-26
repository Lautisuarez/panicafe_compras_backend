const Sequelize = require('sequelize');
const dbData = require('./db-connection');

/**
 * @param {{
 *   host: string,
 *   port: string | undefined,
 *   database: string,
 *   username: string,
 *   password: string,
 * }} cfg
 */
function createMssqlSequelize(cfg) {
  const { host, port, database, username, password } = cfg;
  const options = {
    encrypt: true,
    trustServerCertificate: process.env.NODE_ENV !== 'production',
  };
  const portRaw = port != null ? String(port).trim() : '';
  const portNum = portRaw !== '' ? parseInt(portRaw, 10) : 1433;

  return new Sequelize(database, username, password, {
    host,
    port: Number.isFinite(portNum) ? portNum : 1433,
    dialect: 'mssql',
    dialectOptions: { options },
  });
}

const sequelize = createMssqlSequelize({
  host: dbData.db_host,
  port: dbData.db_port,
  database: dbData.db_name,
  username: dbData.db_user,
  password: dbData.db_password,
});

const invoiceHost = (dbData.invoice_db_host || '').trim();
let sequelizeInvoiceCatalog;
if (invoiceHost) {
  sequelizeInvoiceCatalog = createMssqlSequelize({
    host: dbData.invoice_db_host,
    port: dbData.invoice_db_port,
    database: dbData.invoice_db_name,
    username: dbData.invoice_db_user,
    password: dbData.invoice_db_password,
  });
} else {
  sequelizeInvoiceCatalog = sequelize;
}

const connect = async () => {
  try {
    await sequelize.authenticate();
    await sequelize.sync();
    console.log('MSSQL main connection OK');
    if (sequelizeInvoiceCatalog !== sequelize) {
      await sequelizeInvoiceCatalog.authenticate();
      console.log('[db-invoice] MSSQL catalog connection OK');
    }
  } catch (error) {
    console.error(error.message);
    process.exit(-1);
  }
};

module.exports = {
  sequelize,
  sequelizeInvoiceCatalog,
  connect,
};
