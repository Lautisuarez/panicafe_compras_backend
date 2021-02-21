
const express = require('express');
const db = require ('../db/db')
const Sequelize = require('sequelize');

const middlewares = {};
 


//Middleware para ver si estan todos los campos obligatorios completos para reservar el turno
//middlewares.checkDbConnection = async (req, res, next) => {
   
   

/*
middlewares.chequearTurnoDisponible = async (req, res, next) => {
    const idTurno = req.body.idTurno;
  try{
    let estadoTurno = await db.sequelize.query(
        `SELECT disponible FROM turnoadmin WHERE idTurno = ${idTurno}`,
        {
            raw: true
        }
    )
    
    .then(estadoTurno => {
        if(estadoTurno[0][0].disponible == 0) {
            res.json("Turno Ocupado")
        } else {
            next()
        }
    })
    }
    catch{
        res.status(500).json("Error de parametro")
    }

}
//Middleware para chequear la existencia de un usuario - Editar 	


middlewares.chequearExistenciaUsuario = async (req, res, next) => {
    const fields = req.body;
    await db.sequelize.query(
        `SELECT name FROM clientes WHERE email = "${fields.email}"`,
        {
            type: db.sequelize.QueryTypes.SELECT
        })
        .then(response => {
            if(response.length !== 0){
                
                next()   
            }else{
                res.status(403).json("Usted no tiene un usuario registrado por lo que no puede tener turnos.")
            }
        })
            .catch(err => {
                res.status(500).json({
                    mensaje: 'Internal Server Error',
                    err: err
                });
            });
}


    
*/
middlewares.checkPedidos = (req, res, next) => {
    console.log("pasando por el middleware")
    
    next()
}

module.exports = middlewares

