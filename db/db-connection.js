const db_host = "780e077ce364.sn.mynetname.net";
const db_name = "master";
const db_user = "sa";
const db_password = "Panicafe2018";
const db_port = "14338";
const db_instance = "MSSQLSERVER01" //revisar dato

module.exports = {
    db_host,
    db_name,
    db_user,
    db_password,
    db_port,
    db_instance
};

const mongoose = require('mongoose');
mongoose.connect('mongodb://localhost:27017/panicafe');

const usuarios = mongoose.model('users' , {
    id : Number,
    isAdmin: Number,
    usuario: String,
    pass: String,
    nombre: String,
    email: String
});
module.exports = { mongoose, usuarios}
