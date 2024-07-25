require('dotenv').config();

const MONGO_HOST = process.env.MONGO_HOST
const MONGO_PORT = process.env.MONGO_PORT
const MONGO_DB = process.env.MONGO_DB

const mongoose = require('mongoose');
mongoose.connect(`mongodb://${MONGO_HOST}:${MONGO_PORT}/${MONGO_DB}`);


const usuarios = mongoose.model('users' , {
    id: Number,
    isAdmin: Number,
    usuario: String,
    pass: String,
    nombre: String,
    email: String
});
module.exports = { mongoose, usuarios}
