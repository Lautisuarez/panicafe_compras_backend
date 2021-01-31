const Sequelize = require('sequelize');
const dbData = require('./db-connection');
const sequelize = new Sequelize(dbData.db_name, dbData.db_user, dbData.db_password, {
    host: dbData.db_host,
    port: dbData.db_port,
    dialect: 'mssql',
    dialectModulePath:`sequelize-msnodesqlv8`,
        dialectOptions:{
            instanceName: dbData.db_instance,
            trustedConnection: true
        },
});


const connect = async () => {
    try {
        await sequelize.authenticate();
        await sequelize.sync();
        
        console.log('Connection to the database has been established successfully.');
    }
    catch (error) {
        console.error(error.message);
        process.exit(-1);
    }
};

const database = {
    sequelize: sequelize,
    connect
}

module.exports= database;
