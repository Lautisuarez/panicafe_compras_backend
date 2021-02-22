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
    t = new Date()
    z = t.getTimezoneOffset() * 60 * 1000
    tLocal = t-z
    tLocal = new Date(tLocal)
    date = tLocal.toISOString()
    date = date.slice(0, 19)
    date = date.replace('T', ' ')


    console.log("Server initialized at port 3001 " + date);
})
//Middlewares
server.use(bodyParser.json());

//Routes Handler 
//sss
server.use('/', routes);
