const express = require("express");
const { pool } = require("./database");
require("dotenv").config();
const app = express();
const http = require("http").Server(app);
var oracledb = require("oracledb");
var moment = require("moment");
var momentstz = require("moment-timezone");
const bodyParser = require("body-parser");
const cors = require("cors");

// Use CORS middleware
const corsOptions = {
  origin: "*",
  methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization", "X-Requested-With"],
};

app.use(cors(corsOptions));

app.use(
  express.json({
    limit: "20mb",
  })
);

app.use(
  bodyParser.json({
    limit: "20mb",
  })
);
app.use(
  bodyParser.urlencoded({
    limit: "20mb",
    extended: true,
  })
);
var admin = require("firebase-admin");

var serviceAccount = require("./serviceAccountKey.json");
const { stat } = require("fs");
const { log } = require("console");

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

const port = process.env.port;

app.get("/", (req, res) =>
  res.status(200).json({
    status: 200,
    message: "Hello world",
    description: "This api is developed by Osama",
  })
);

// My Work
// app.get("/getAllUser", (req, res) => {
//   const { departmentcode, present } = req.query;

//   if (!departmentcode) {
//     return res.json({ status: false, message: "Department code is null" });
//   }
//   pool().execute(
//     `SELECT emp.id, emp.firstname name, atn.entrytime, atn.leaveingtime, get_departmenttitle(emp.department_id) dept FROM employeeinfo emp
//       LEFT JOIN attendence atn ON emp.id = atn.fk_empid AND Trunc(atn.entrytime) between Trunc(sysdate) and Trunc(sysdate) WHERE emp.department_id = :department_id AND exitdate IS NULL ${present ? present == 'true' ? " AND entrytime IS NOT NULL" : "" : ""} ORDER BY name`,
//     {
//       department_id: departmentcode,
//     },
//     { outFormat: oracledb.OBJECT },
//     (error, result) => {
//       if (error) {
//         console.log(error);
//         return res.json({ status: false, message: "Something went wrong" });
//       } else {
//         return res.json({ status: true, data: result.rows });
//       }
//     }
//   );
// });

app.get("/getAllUser", async (req, res) => {
  const { departmentcode, present } = req.query;
  try {
    const attendanceResult = await pool().execute(
      `BEGIN pr_getdepattn(:vdept, :retval); END;`,
      {
        vdept: departmentcode,
        retval: { dir: oracledb.BIND_OUT, type: oracledb.CURSOR },
      },
      { outFormat: oracledb.OBJECT }
    );
    const resultSet = attendanceResult.outBinds.retval;
    const rows = await resultSet.getRows();
    await resultSet.close();
    res.json({ status: true, data: rows });
  } catch (err) {
    console.error("Error executing procedure:", err);
    res.status(500).json({
      status: false,
      message: "An error occurred",
      error: err.message,
    });
  }
});

app.post("/getByEmpId", (req, res) => {
  const { empid, todate, fromdate } = req.body;
  pool().execute(
    `SELECT e.firstname, e.lastname, e.id , get_departmenttitle(e.department_id) dept
    FROM employeeinfo e
    WHERE e.id = : empid`,
    { empid },
    { outFormat: oracledb.OBJECT },
    async (error, result) => {
      if (error) {
        res.status(500).json({ error: "An error occurred" });
      } else {
        if (!result?.rows?.length) {
          return res.status(404).json({ error: "Employee not found" });
        }
        const getUserDataPromises = result?.rows?.map(async (employee) => {
          const attendanceResult = await pool().execute(
            `CALL get_month_details(:empid,:fromdate,:todate,0,:cursor1)`,
            {
              todate: todate,
              fromdate: fromdate,
              empid: employee.ID,
              cursor1: { dir: oracledb.BIND_OUT, type: oracledb.CURSOR },
            },
            { outFormat: oracledb.OBJECT }
          );
          const resultSet = attendanceResult.outBinds.cursor1;
          const attendanceRows = await resultSet.getRows();
          const attendanceInFormat = attendanceRows.map((elem) => ({
            date: elem.DATEWITHDAY,
            remark: elem.REMARKS.trim(),
            id: elem.FK_EMPID,
            entryTime: elem.ENTRYTIME,
            leavingTime: elem.LEAVEINGTIME,
            attendanceDate: elem.ATTENDANCEDATE,
            hours: elem.HOURS,
            totalHours: elem.TIMEDIFF,
            late: elem.GRACETIMEPERIOD,
            leaveRemark: elem.LEAVEREMARK,
          }));
          return {
            firstname: employee.FIRSTNAME,
            id: employee.ID,
            dept: employee.DEPT,
            attendanceData: attendanceInFormat,
          };
        });

        const getUserData = await Promise.all(getUserDataPromises);
        const groupedData = getUserData.reduce((acc, item) => {
          if (!acc[item.dept]) {
            acc[item.dept] = [];
          }
          acc[item.dept].push(item);
          return acc;
        }, {});
        res.status(200).json(groupedData);
      }
    }
  );
});

app.post("/getAllEmployeesAttendance", async (req, res) => {
  const { todate, fromdate } = req.body;
  const { departmentcode, present } = req.query;
  try {
    const attResult = await pool().execute(
      `BEGIN pr_getallattn(:vdept, :retval); END;`,
      {
        vdept: departmentcode,
        retval: { dir: oracledb.BIND_OUT, type: oracledb.CURSOR },
      },
      { outFormat: oracledb.OBJECT }
    );
    const resultSet = attResult.outBinds.retval;
    const rows = await resultSet.getRows();
    const getAttendancePromises = rows.map(async (employee) => {
      const attendanceResult = await pool().execute(
        `CALL get_month_details(:empid, :fromdate, :todate, 0, :cursor1)`,
        {
          empid: employee.ID,
          fromdate,
          todate,
          cursor1: { dir: oracledb.BIND_OUT, type: oracledb.CURSOR },
        },
        { outFormat: oracledb.OBJECT }
      );
      const resultSet = attendanceResult.outBinds.cursor1;
      const attendanceRows = await resultSet.getRows();

      const attendanceData = attendanceRows.map((row) => ({
        workingday: row.WORKINGDAY,
        date: row.DATEWITHDAY,
        remark: row.REMARKS.trim(),
        entryTime: row.ENTRYTIME,
        leavingTime: row.LEAVEINGTIME,
        attendanceDate: row.ATTENDANCEDATE,
        hours: row.HOURS,
        totalHours: row.TIMEDIFF,
        late: row.GRACETIMEPERIOD,
        date1: row.DAYDATE,
        leaveRemark: row.LEAVEREMARK,
      }));

      return {
        id: employee.ID,
        firstname: employee.NAME,
        dept: employee.DEPT,
        attendanceData,
      };
    });

    const allEmployeesAttendance = await Promise.all(getAttendancePromises);
    const groupedData = allEmployeesAttendance.reduce((acc, item) => {
      if (!acc[item.dept]) {
        acc[item.dept] = [];
      }
      acc[item.dept].push(item);
      return acc;
    }, {});
    res.status(200).json(groupedData);
  } catch (error) {
    console.log(error);
  }
});


app.get("/getAllDept", async (req, res) => {
  const { departmentcode, present } = req.query;
  try {
    const attResult = await pool().execute(
      `BEGIN pr_getallattn(:vdept, :retval); END;`,
      {
        vdept: departmentcode,
        retval: { dir: oracledb.BIND_OUT, type: oracledb.CURSOR },
      },
      { outFormat: oracledb.OBJECT }
    );
    const resultSet = attResult.outBinds.retval;
    const rows = await resultSet.getRows();
    await resultSet.close();
    res.status(200).json(rows);
  } catch (error) {
    console.log(error);
  }
});

app.post("/getLeaves", async (req, res) => {
  const { todate, fromdate, empid } = req.body;
  try {
    const leaveResult = await pool().execute(
      `BEGIN  get_employeesabsents(:fromdate, :todate, :vempid, :vabsents, :vsickleaves, :vsickleavesavailed, :vtotalleaves, :vtotalLeavesAvailable); END;`,
      {
        fromdate: fromdate,
        todate: todate,
        vempid: empid,
        vabsents: { dir: oracledb.BIND_OUT, type: oracledb.NUMBER },
        vsickleaves: { dir: oracledb.BIND_OUT, type: oracledb.NUMBER },
        vsickleavesavailed: { dir: oracledb.BIND_OUT, type: oracledb.NUMBER },
        vtotalleaves: { dir: oracledb.BIND_OUT, type: oracledb.NUMBER },
        vtotalLeavesAvailable: {
          dir: oracledb.BIND_OUT,
          type: oracledb.NUMBER,
        },
      },
      { outFormat: oracledb.OBJECT }
    );
    res.send({
      absents: leaveResult.outBinds.vabsents,
      sickleaves: leaveResult.outBinds.vsickleaves,
      sickleavesavailed: leaveResult.outBinds.vsickleavesavailed,
      totalleaves: leaveResult.outBinds.vtotalleaves,
      totalLeavesAvailable: leaveResult.outBinds.vtotalLeavesAvailable,
    });
  } catch (error) {
    console.log(error);
  }
});

http.listen(port, () => {
  console.log(`App started on ${port}!`);
});
