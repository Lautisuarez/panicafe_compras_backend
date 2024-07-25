require('dotenv').config();

const db_host = process.env.DB_HOST;
const db_name = process.env.DB_NAME;
const db_user = process.env.DB_USER;
const db_password = process.env.DB_PASSWORD;
const db_port = process.env.DB_PORT;
const db_instance = process.env.DB_INSTANCE; 

module.exports = {
    db_host,
    db_name,
    db_user,
    db_password,
    db_port,
    db_instance
};

