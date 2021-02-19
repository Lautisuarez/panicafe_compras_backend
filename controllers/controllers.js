var datefns = require('date-fns')

const db = require('../db/db');
const controllers = {};
const bodyparser = require('body-parser')
const express = require('express');
const { response } = require('express');
const router = express.Router()

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
// insert into MRCCENTRAL.DBO.car_pedidos (idCliente , fecha, PrecioTotal ) values (2, '19/2/2021 09:17:11', 200);

controllers.postPedido = async (req, res) => {
    let pedido = req.body
    try {
        
        //Obtengo en el ultimo IdPedido
        let idPedidoFromSQL = await db.sequelize.query(
            `SELECT top 1 idPedido FROM MRCCENTRAL.DBO.car_pedidos order by idPedido DESC ;`,
            {
                type: db.sequelize.QueryTypes.SELECT
            }
        )
        .then(pedido => {
            console.log(pedido)
        } )
           /* let insertPedido = db.sequelize.query(
                `insert into MRCCENTRAL.DBO.car_pedidos (idCliente , fecha, PrecioTotal ) values (${pedido.idCliente}, ${pedido.fecha}, ${pedido.precioTotal});`
            )
            //res.json(idPedidoFromSQL[0].idPedido)

        })
        .then (idPedidoFromSQL, pedido => {
            for (let i = 0; i <= pedido.productos.length; i++) {
                let insertProductos = `insert into MRCCENTRAL.DBO.car_productos (idPedido, idProducto, descripcion, preciounit, cantidad) 
                VALUES ( ${idPedidoFromSQL[0].idPedido + 1}, ${pedido.productos[i].idProducto}, ${pedido.productos[i].descripcion}, ${pedido.productos[i].preciounit},
                    , ${pedido.productos[i].cantidad});`
            }

        } )*/

        res.status(201).json("pedido creado")

    } catch(e) {
        res.status(500).json(`Error al ingresar el pedido ${e}`)
    }
}
/*
controllers.usuarioExiste = async (req, res) => {
    const datos = req.body;
    await db.sequelize.query (
        "UPDATE `turnoadmin` SET `disponible` = 0 WHERE `idTurno` = " + `${datos.idTurno}` + ";"
    )
        let getIdTurno = await db.sequelize.query(
            `SELECT idCliente FROM clientes WHERE email =  "${datos.email}"`,
            {
                type: db.sequelize.QueryTypes.SELECT
            })
            .then( getIdTurno => {

                 db.sequelize.query(
                    `INSERT INTO turnosclientes (idCliente, idTurno) VALUES (${getIdTurno[0].idCliente}, ${datos.idTurno})`
                )
                res.json("ejecutando")
            })
}

controllers.generateTurno = async(req,res)=>{

    const {fechaHora, cantidad} = req.body;

    let fechaInicio = new Date(fechaHora)
   

    for (let index = 0; index < cantidad; index++) {

        
        await db.sequelize.query (
            `INSERT INTO turnoadmin (horaInicio, disponible) VALUES ("${datefns.format(fechaInicio, 'yyyy-MM-dd HH:mm:ss')}", 1)`
        )
       
        fechaInicio = datefns.addMinutes(fechaInicio,30)

    }
    res.json(fechaInicio)
}

controllers.getTurnosDisponibles = async(req, res) => {
   let turnos = await db.sequelize.query(
        `SELECT * FROM turnoadmin WHERE horaInicio > NOW() AND disponible = 1`)
    res.json(turnos);
}

controllers.usuarioNoExiste = async (req, res, next) => {
   
    const nuevoTurno = req.body;
    await db.sequelize.query(
        `SELECT * FROM clientes WHERE email =  "${nuevoTurno.email}"`,
        {
            type: db.sequelize.QueryTypes.SELECT,
            replacements: {email: nuevoTurno.email}
        })
        .then (response => {
           
            if(response.length !== 0){
                
            next()
            } else { 
                db.sequelize.query(
       
                    `INSERT INTO clientes (
                        name,
                        email,
                        phone
                    )
                    VALUE (
                        :name,
                        :email,
                        :phone
                    )`,
                    
                    {
                        replacements: nuevoTurno
                    })
                next()
                }
            }
        )
    .catch(err => {
        console.log(err)
        res.status(500).json({
            mensaje: 'Internal Server Error',
            err: err
        });
    })
}


let turnosDeCliente = [];

controllers.turnosReservados = async (req, res, next) => {
    fields = req.body
    
    let getIdTurno = await db.sequelize.query(
        `SELECT idCliente FROM clientes WHERE email =  "${fields.email}"`,
        {
            type: db.sequelize.QueryTypes.SELECT
        })
        .then( getIdTurno => {

            turnosDeCliente = db.sequelize.query(
               `SELECT idTurno FROM turnosclientes WHERE idCliente = ${getIdTurno[0].idCliente}`,
               {
                   type: db.sequelize.QueryTypes.SELECT
               }
           )
           
           .then(turnosDeCliente => {
            let turnosResult = [];
            
            /* hacer un for y un push para armar los datos a devolver)
            
           for(let index = 0; index < turnosDeCliente.length; index++) {
               let querys = db.sequelize.query(
                   `SELECT * FROM turnoadmin WHERE idTurno = ${turnosDeCliente[index].idTurno} and horaInicio > now()`,
                   {
                       type: db.sequelize.QueryTypes.SELECT
                   }
               )
               .then(querys => {
                   console.log(querys)
               if (querys != ""){
                turnosResult.push(querys[0])
               } 
               
               if (index == turnosDeCliente.length -1) {
                res.json(turnosResult)
               } else {
                   console.log(index, turnosDeCliente.length)
               }
               }) 
               
           }
           
           })
            }
            
        )
}
/*
controllers.turnosReservados1 = async (req, res, next) => {
idTurnoCliente = turnosDeCliente

controllers.turnosReservados1 = async (req, res, next) => {
    fields = req.body
    let turnosDeCliente = [];
    let getIdTurno = await db.sequelize.query(
        `SELECT idCliente FROM clientes WHERE email =  "${fields.email}"`,
        {
            type: db.sequelize.QueryTypes.SELECT
        })
        .then( getIdTurno => {

            turnosDeCliente = db.sequelize.query(
               `SELECT idTurno FROM turnosclientes WHERE idCliente = ${getIdTurno[0].idCliente}`,
               {
                   type: db.sequelize.QueryTypes.SELECT
               }
           )
           .then(turnosDeCliente => {
            res.json(turnosDeCliente) 
           })
            }
            
        )
}

then(turnosDeCliente => {
    let fechas = await db.sequelize.query(
        `SELECT horaInicio FROM turnoadmin where idTurno =${turnosDeCliente}`,
        {
            type: db.sequelize.QueryTypes.SELECT
        }

//controller.CancelarTurno
controllers.cancelarTurno = async (req, res, next) => {
    const idTurno = req.body;
    let cita = [];
    let idUser = await db.sequelize.query(
        `SELECT idCliente from clientes WHERE email = '${idTurno.email}'`
    )
        
        .then(idUser => {
            cita = db.sequelize.query(
            `DELETE FROM turnosclientes WHERE (idCliente = ${idUser[0][0].idCliente} AND idTurno = ${idTurno.idTurno});`)
        }) .then(cita => {
            res.status("Paso a la siguiente validacion")
        }) 
        .catch(err => {
            res.status(500).json({
                mensaje: 'Internal Server Error',
                err: err
            });
        });
        next(); 
}

controllers.disponibilizarTurno = async (req, res) => {
    const idTurno1 = req.body;
    await db.sequelize.query(
        `UPDATE turnoadmin SET disponible = '1' WHERE (idTurno = '${idTurno1.idTurno}')`
        ).then(response => {
            res.status(200).json({message: "El turno ha sido cancelado"})
        })
        .catch(err => {
            res.status(500).json({
                mensaje: 'Internal Server Error',
                err: err
                });
        }); 
}
*/
module.exports = controllers;