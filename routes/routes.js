const express = require('express');
const Sequelize = require('sequelize');
const router = express.Router();
const controllers = require('../controllers/controllers');
const middlewares = require('../middlewares/middlewares');


//Traemos los productos de la DB de mr comanda
router.get('/productos',middlewares.checkJWT, controllers.getProductos);
router.post('/pedidos',middlewares.checkJWT, controllers.postPedido)

router.post('/adduser',middlewares.checkJWT, middlewares.checkIfAdminJWT, middlewares.checkIsExist, controllers.addUser)
router.get('/getInfoAddUser',middlewares.checkJWT,middlewares.checkIfAdminJWT,  controllers.getInfoAddUser)
router.post('/login', controllers.login)
router.put('/editUser', middlewares.checkIfAdminJWT, middlewares.checkIsExistEdit, controllers.editUser)


// ENDPOINTS QUE FALTAN ABM USUARIOS 
// Por cada tarea un PR, es decir una branch para cada endpoint.
// git checkout -b "feat/<Nombre>"
// git add, git commit, git push
// Merge request, su_branch -> master

// - Validar que el usuario no exista cuando se crea uno nuevo (que sea unico)(que sea todo en minuscula, validar en mongodb) listo
// - Obtener usuarios para devolver listado
// - Cambiar contraseña --> Yo te mando el usuario (ya que es unico y el id no) 
// - Eliminar usuario

module.exports = router;
