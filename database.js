var oracledb = require("oracledb");
let connection;
require("dotenv").config();
oracledb.initOracleClient({
  libDir: "./Oracle/instantclient_21_3",
});
const connection1 = async () => {
  try {
    connection = await oracledb.getConnection({
      user: process.env.user,
      password: process.env.password,
      connectString: process.env.connectString,
    });
    console.log("Successfully connected to Oracle!");
  } catch (err) {
    console.log(err,"err");
  }
};

function pool() {
  if (!connection) {
    console.log("Database not connected");
    connection1();
  } else {
    return connection;
  }
}
connection1();
module.exports = { pool };
