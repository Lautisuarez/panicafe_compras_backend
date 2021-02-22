const mongoose = require('mongoose');
mongoose.connect('mongodb://107.180.107.29:27017/panicafe');


const usuarios = mongoose.model('users' , {
    isAdmin: Number,
    usuario: String,
    pass: String,
    nombre: String,
    email: String
});
module.exports = { mongoose, usuarios}
