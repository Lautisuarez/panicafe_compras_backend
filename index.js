//Express
const express = require('express');
const server = express ();
const cors = require('cors')

server.use(cors())

//Body Parser
const bodyParser = require('body-parser');

//Conexion con archivos de rutas
const routes = require('./routes/routes');

//Inicializar servidor
server.listen(3001, () => {
    const date = new Date();
    console.log("Server initialized " + date);
})
//Middlewares
server.use(bodyParser.json());

//Routes Handler
server.use('/', routes);
