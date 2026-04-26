const productController = require("./productController");
const orderController = require("./orderController");
const userController = require("./userController");
const invoiceController = require("./invoiceController");

module.exports = {
  ...productController,
  ...orderController,
  ...userController,
  ...invoiceController,
};
