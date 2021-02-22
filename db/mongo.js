const mongoose = require('mongoose');
mongoose.connect('mongodb://localhost:27017/panicafe');


const usuarios = mongoose.model('users' , {
    isAdmin: Number,
    usuario: String,
    pass: String,
    nombre: String,
    email: String
});
module.exports = { mongoose, usuarios}
