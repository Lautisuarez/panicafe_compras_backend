var datefns = require('date-fns')

const db = require('../db/db');
const controllers = {};
const bodyparser = require('body-parser')
const express = require('express');
const { response } = require('express');
const router = express.Router()
const mongo = require('../db/mongo');
const {privateKey, jwt} = require ('../jwt/jwt');


controllers.getProductos = async (req, res) => {



try {
    let resultSelect = await db.sequelize.query(
        `SELECT CODIGO, DESCRIP, PRECIO FROM MRCCENTRAL.DBO.ARTICULO WHERE SEVENDE=1 AND INVISIBL=0 AND WEB=1 ORDER BY DESCRIP`,
        {
            type: db.sequelize.QueryTypes.SELECT
        })
        
        .then(resultSelect => {
              
              let resultToSend = resultSelect.map( item => { 
                return { id: item.CODIGO , descripcion : item.DESCRIP, precio: item.PRECIO }; 
                
              });  
              for(var n =0; n < resultToSend.length; n++){
                resultToSend[n].id = parseInt(resultToSend[n].id);
                resultToSend[n].descripcion= resultToSend[n].descripcion.trim()
              }
              res.json(resultToSend)
              
        })
        


}
catch{
res.status(500).json("La base de datos de Mr. Comanda no esta respondiendo.")
}
}

controllers.postPedido = async (req, res) => {
    
    try {
        let pedido = req.body
        //Obtengo en el ultimo IdPedido
        let idPedidoFromSQL =  await db.sequelize.query(
            `SELECT top 1 idPedido FROM MRCCENTRAL.DBO.car_pedidos order by idPedido DESC ;`,
            {
                type: db.sequelize.QueryTypes.SELECT
            }
            
            )
           //Cargo la tabla pedidos
        .then(idPedidoFromSQL  => {

            let insertPedido = db.sequelize.query(
                `insert into MRCCENTRAL.DBO.car_pedidos (idCliente , fecha, PrecioTotal ) values (${pedido.idCliente}, '${pedido.fecha}', ${pedido.precioTotal});`
            )
            // Cargo la tabla productos con los pedidos
            .then (response => {
                pedido2 = req.body

            for (let i = 0; i <= pedido2.productos.length -1; i++) {
               
                let insertProductos =  db.sequelize.query(
                    `insert into MRCCENTRAL.DBO.car_productos (idPedido, idProducto, descripcion, preciounit, cantidad) 
                VALUES ( ${idPedidoFromSQL[0].idPedido + 1}, ${pedido2.productos[i].idProducto}, '${pedido2.productos[i].descripcion}', ${pedido2.productos[i].preciounit},
                ${pedido2.productos[i].cantidad});`
                )
            }
        } 
        )
        
        } )

        res.status(201).json("pedido creado")

    } catch(e) {
        res.status(500).json(`Error al ingresar el pedido ${e}`)
    }
}


//Gestion de usuarios

controllers.addUser = async (req, res) => {
    datos = req.body
    
    let createMongoUser = {
        isAdmin: datos.isAdmin,
        usuario: datos.usuario,
        pass: datos.pass,
        nombre: datos.nombre,
        email: datos.email
    }
    

    //console.log(mongo.mongoose.connection.readyState);
    //const saveToMongo = new mongo.usuarios(createMongoUser)

    const newUser = new mongo.usuarios(createMongoUser)

    
    newUser.save()
    res.json("usuario creado") //mandar state y revisar primero
    
}

controllers.login = async (req, res) => {
    datos = req.body
    const query = mongo.usuarios.find({usuario:datos.usuario})
    .then(function(result){
        ab = result[0].usuario
        ac = result[0].pass 
      //  console.log(ab, ac, datos.usuario, datos.pass)
        if ((ab === datos.usuario) && (ac === datos.pass)) {

            const payload = {
                check:  true
               };
               const token = jwt.sign(payload, privateKey, {
                expiresIn: 1440
               });
           res.json({
            mensaje: 'Autenticación correcta',
            token: token
           })
        } else {
           res.json("Usuario o contraseña incorrecta")
        }

    }
    .catch(e) (
        res.json("No existe el usuario")
    )
    )
    
   
}




module.exports = controllers;
