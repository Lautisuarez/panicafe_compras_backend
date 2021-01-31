const express = require('express');
const Sequelize = require('sequelize');

const controllers = require('../controllers/controllers');
const middlewares = require('../middlewares/middlewares');


//Traemos los productos de la DB de mr comanda
router.get('/productos', middlewares.checkDbConnection, controllers.dbOK); //rrevisar




module.exports = router;