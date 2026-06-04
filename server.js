const express = require("express");
const session = require("express-session");
const bodyParser = require("body-parser");
const sqlite3 = require("sqlite3").verbose();
const path = require("path");
const multer = require("multer");
const { Worker } = require("worker_threads");
const { fork } = require("child_process");
const fs = require("fs");
const app = express();
const PORT = 3000;

// Setup multer for parsing multipart/form-data
const upload = multer();

// Setup express-session (kept for admin-panel.html route only)
app.use(session({
  secret: "eduaid_admin_secret",
  resave: false,
  saveUninitialized: true,
  cookie: { maxAge: 1 * 60 * 60 * 1000 }, // 1 hour
}));

// Connect to SQLite
const db = new sqlite3.Database(
  path.join(__dirname, "data", "eduaid.db"),
  (err) => {
    if (err) return console.error("Database connection error:", err.message);
    console.log("✅ Connected to SQLite database");
  }
);
const nodemailer = require("nodemailer");

const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: "visionofaatazaz@gmail.com",
    pass: "gymi lozw nkvw dfwo"
  }
});
db.run(`CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT,
  email TEXT UNIQUE,
  password TEXT
)`);

// Create tables if not exist
db.run(`CREATE TABLE IF NOT EXISTS applications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT,
  father_name TEXT,
  dob TEXT,
  domicile TEXT,
  city TEXT,
  phone TEXT,
  email TEXT,
  inter_uni TEXT,
  inter_cgpa TEXT,
  bachelor_uni TEXT,
  bachelor_cgpa TEXT,
  master_uni TEXT,
  master_cgpa TEXT,
  phd_uni TEXT,
  phd_cgpa TEXT,
  scholarship_type TEXT,
  status TEXT DEFAULT 'Unverified',
  submitted_at TEXT DEFAULT CURRENT_TIMESTAMP
)`);

db.run(`CREATE TABLE IF NOT EXISTS scholarships (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  description TEXT,
  eligibility TEXT,
  deadline TEXT,
  seats_left INTEGER
)`);

// Create crawled_scholarships table for crawler results
db.run(`CREATE TABLE IF NOT EXISTS crawled_scholarships (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  description TEXT,
  eligibility TEXT,
  deadline TEXT,
  source_url TEXT,
  crawled_at TEXT DEFAULT CURRENT_TIMESTAMP,
  saved INTEGER DEFAULT 0
)`);

// Ensure 'notified' column exists (adds once)
db.all("PRAGMA table_info(applications);", (err, columns) => {
  if (err) return console.error("❌ Failed to inspect table:", err.message);

  const hasNotified = columns.some(col => col.name === 'notified');
  if (!hasNotified) {
    db.run(`ALTER TABLE applications ADD COLUMN notified INTEGER DEFAULT 0`, (err) => {
      if (err) return console.error("❌ Failed to alter table:", err.message);
      console.log("✅ 'notified' column added to applications table.");
    });
  }
});


app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static("public"));
app.set("view engine", "ejs");

// Routes
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "home.html"));
});

const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");

const JWT_SECRET = "eduaid_user_secret"; // Keep this secure

// User registration
app.post("/api/register", upload.none(), async (req, res) => {
  const { name, email, password } = req.body;
if (email === "admin@gmail.com" || name.toLowerCase() === "admin") {
  return res.status(403).send("Registration using admin credentials is not allowed.");
}

  const hashedPassword = await bcrypt.hash(password, 10);
  const query = `INSERT INTO users (name, email, password) VALUES (?, ?, ?)`;

  db.run(query, [name, email, hashedPassword], function (err) {
    if (err) {
      console.error(err.message);
      return res.status(400).send("User already exists or invalid data.");
    }
    res.send("User registered successfully.");
  });
});
app.post("/api/login", upload.none(), (req, res) => {
  const { email, password } = req.body;

  db.get("SELECT * FROM users WHERE email = ?", [email], async (err, user) => {
    if (err || !user) return res.status(401).send("Invalid credentials.");

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) return res.status(401).send("Invalid credentials.");

    const token = jwt.sign({ id: user.id, email: user.email }, JWT_SECRET, { expiresIn: "2h" });
    res.json({ token, name: user.name });
  });
});
function verifyUserToken(req, res, next) {
  const authHeader = req.headers.authorization;
  const token = authHeader && authHeader.split(" ")[1];

  if (!token) return res.sendStatus(401);

  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) return res.sendStatus(403);
    req.user = user;
    next();
  });
}
app.get("/api/user-profile", verifyUserToken, (req, res) => {
  res.json({ message: "Welcome to your profile", user: req.user });
});

// Application submission
app.post("/submit-application", upload.single("documents"), (req, res) => {
  const data = req.body;
  const query = `
    INSERT INTO applications (
      name, father_name, dob, domicile, city, phone, email,
      inter_uni, inter_cgpa,
      bachelor_uni, bachelor_cgpa,
      master_uni, master_cgpa,
      phd_uni, phd_cgpa,
      scholarship_type
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `;
  const values = [
    data.name, data.fatherName, data.dob, data.domicile, data.city,
    data.phone, data.email,
    data.interUni || "N/A", data.interCgpa || "N/A",
    data.bachelorUni || "N/A", data.bachelorCgpa || "N/A",
    data.masterUni || "N/A", data.masterCgpa || "N/A",
    data.phdUni || "N/A", data.phdCgpa || "N/A",
    data.scholarshipType
  ];
  db.run(query, values, function (err) {
    if (err) {
      console.error(err.message);
      return res.status(500).send("Something went wrong.");
    }
    res.send("Application submitted successfully!");
  });
});

// Application status check
app.get("/status", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "status.html"));
});

app.post("/status-check", upload.none(), (req, res) => {
  const { scholarshipType } = req.body;
  const query = `
    SELECT name, father_name,
      CASE 
        WHEN phd_cgpa != 'N/A' AND phd_cgpa != '' THEN 'PhD'
        WHEN master_cgpa != 'N/A' AND master_cgpa != '' THEN 'Master'
        WHEN bachelor_cgpa != 'N/A' AND bachelor_cgpa != '' THEN 'Bachelor'
        WHEN inter_cgpa != 'N/A' AND inter_cgpa != '' THEN 'Intermediate'
        ELSE 'N/A'
      END AS highest_degree,
      status
    FROM applications
    WHERE scholarship_type = ?
  `;
  db.all(query, [scholarshipType], (err, rows) => {
    if (err) return res.status(500).send("Error fetching status.");

    let html = `
    <html><head><title>Status</title>
    <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/css/bootstrap.min.css" rel="stylesheet" />
    </head><body class="bg-light">
    <div class="container py-5">
    <h2 class="text-center text-success">Applications for: ${scholarshipType}</h2>
    <table class="table table-bordered bg-white">
      <thead class="table-success text-center">
        <tr><th>Name</th><th>Father Name</th><th>Highest Degree</th><th>Status</th></tr>
      </thead><tbody>`;

    rows.forEach(row => {
      const badge = row.status === 'Granted' ? 'success' :
                    row.status === 'Not Eligible' ? 'danger' :
                    row.status === 'Verified' ? 'warning' : 'secondary';
      html += `<tr class="text-center">
        <td>${row.name}</td>
        <td>${row.father_name}</td>
        <td>${row.highest_degree}</td>
        <td><span class="badge bg-${badge}">${row.status}</span></td>
      </tr>`;
    });

    html += `</tbody><tr><div class="text-center">
      <a href="/status" class="btn btn-outline-success">🔙 Check Another</a></div></div></body></html>`;
    res.send(html);
  });
});

// Admin login/logout
app.post("/admin-login", upload.none(), (req, res) => {
  const { username, password } = req.body;
  if (username === "admin" && password === "1234") {
    req.session.admin = true;
    res.redirect("/admin-panel.html");
  } else {
    res.send('<h3 style="color:red; text-align:center;">Invalid credentials! <a href="/admin-login.html">Try again</a></h3>');
  }
});

app.get("/admin-panel.html", (req, res) => {
  // Allow access without session check (removed for Firebase)
  res.sendFile(path.join(__dirname, "public", "admin-panel.html"));
});

app.get("/logout", (req, res) => {
  req.session.destroy(() => res.redirect("/admin-login.html"));
});

// Admin API for applications - NO SESSION CHECK
app.get("/api/applications", (req, res) => {
  db.all("SELECT * FROM applications ORDER BY submitted_at DESC", [], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });

    // Mark unseen applications as notified
    db.run("UPDATE applications SET notified = 1 WHERE notified = 0", (err) => {
      if (err) console.error("Failed to update notification status:", err.message);
    });

    res.json(rows);
  });
});

app.get("/api/notifications", (req, res) => {
  db.get("SELECT COUNT(*) AS newCount FROM applications WHERE notified = 0", (err, row) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ newCount: row?.newCount || 0 });
  });
});

app.post("/api/update-status", upload.none(), (req, res) => {
  const { id, status } = req.body;

  // First update the status
  db.run("UPDATE applications SET status = ? WHERE id = ?", [status, id], function (err) {
    if (err) return res.status(500).send("Failed to update status.");

    // Fetch user's email and name
    db.get("SELECT email, name, scholarship_type FROM applications WHERE id = ?", [id], (err, row) => {
      if (err || !row) return res.send("Status updated (email failed).");

      // Compose email
      const mailOptions = {
        from: '"EduAid Team" <yourgmail@gmail.com>',
        to: row.email,
        subject: `Your Scholarship Application Status`,
        html: `
          <p>Dear ${row.name},</p>
          <p>Your application for <strong>${row.scholarship_type}</strong> has been updated to: 
          <span style="color: ${status === 'Granted' ? 'green' : status === 'Not Eligible' ? 'red' : 'orange'};">
            <strong>${status}</strong>
          </span>.</p>
          <p>Thank you for applying at <strong>EduAid</strong>.</p>
          <hr />
          <small>Do not reply to this email.</small>
        `
      };

      // Send the email
      transporter.sendMail(mailOptions, (error, info) => {
        if (error) {
          console.error("❌ Email error:", error.message);
          return res.send("Status updated. Email failed.");
        }
        console.log("✅ Email sent:", info.response);
        res.send("Status updated and email sent.");
      });
    });

    // Reduce seat if status is Granted
    if (status === "Granted") {
      db.get("SELECT scholarship_type FROM applications WHERE id = ?", [id], (err, row) => {
        if (row && row.scholarship_type) {
          db.run("UPDATE scholarships SET seats_left = seats_left - 1 WHERE title = ? AND seats_left > 0",
            [row.scholarship_type], (err) => {
              if (err) console.error("Error updating seats_left:", err.message);
          });
        }
      });
    }
  });
});


app.post("/api/delete", upload.none(), (req, res) => {
  const { id } = req.body;
  db.run("DELETE FROM applications WHERE id = ?", [id], (err) => {
    if (err) return res.status(500).send("Failed to delete application.");
    res.send("Application deleted.");
  });
});

// Scholarship APIs - NO SESSION CHECK
app.get("/api/scholarships", (req, res) => {
  const { search = "", deadline = "" } = req.query;
  const searchTerm = `%${search.trim()}%`;
  const deadlineTerm = `%${deadline.trim()}%`;

  const query = `
    SELECT * FROM scholarships
    WHERE (title LIKE ? OR description LIKE ? OR eligibility LIKE ?)
      AND deadline LIKE ?
      AND seats_left > 0
    ORDER BY deadline ASC
  `;

  db.all(query, [searchTerm, searchTerm, searchTerm, deadlineTerm], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows);
  });
});


app.post("/api/scholarships/add", upload.none(), (req, res) => {
  const { title, description, eligibility, deadline } = req.body;
  const seats = parseInt(req.body.seats_left, 10) || 0;
  const query = `INSERT INTO scholarships (title, description, eligibility, deadline, seats_left) VALUES (?, ?, ?, ?, ?)`;
  db.run(query, [title, description, eligibility, deadline, seats], (err) => {
    if (err) {
      console.error("Add Error:", err.message);
      return res.status(500).send("Failed to add scholarship.");
    }
    res.send("Scholarship added.");
  });
});

app.post("/api/scholarships/edit", upload.none(), (req, res) => {
  const { id, title, description, eligibility, deadline } = req.body;
  const seats = parseInt(req.body.seats_left, 10) || 0;
  const query = `UPDATE scholarships SET title=?, description=?, eligibility=?, deadline=?, seats_left=? WHERE id=?`;
  db.run(query, [title, description, eligibility, deadline, seats, id], (err) => {
    if (err) {
      console.error("Edit Error:", err.message);
      return res.status(500).send("Failed to update scholarship.");
    }
    res.send("Scholarship updated.");
  });
});

app.post("/api/scholarships/delete", upload.none(), (req, res) => {
  const { id } = req.body;
  db.run("DELETE FROM scholarships WHERE id = ?", [id], (err) => {
    if (err) return res.status(500).send("Failed to delete scholarship.");
    res.send("Scholarship deleted.");
  });
});
const PDFDocument = require("pdfkit");

app.post("/api/download-selected", upload.none(), (req, res) => {
  const ids = req.body.ids;
  const idArray = ids.split(",").map(id => parseInt(id.trim())).filter(id => !isNaN(id));

  if (idArray.length === 0) return res.status(400).send("No valid IDs provided.");

  const placeholders = idArray.map(() => "?").join(",");
  const query = `SELECT * FROM applications WHERE id IN (${placeholders})`;

  db.all(query, idArray, (err, rows) => {
    if (err) return res.status(500).send("Database error");

    const doc = new PDFDocument();
    const filename = `Selected_Applications_${Date.now()}.pdf`;

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);

    doc.pipe(res);
    doc.fontSize(18).text("Selected Applications", { align: "center" }).moveDown();

    rows.forEach((app, index) => {
      doc.fontSize(12).text(`Application #${app.id}`, { underline: true });
      doc.text(`Name: ${app.name}`);
      doc.text(`Father Name: ${app.father_name}`);
      doc.text(`Email: ${app.email}`);
      doc.text(`Phone: ${app.phone}`);
      doc.text(`City: ${app.city}`);
      doc.text(`Scholarship: ${app.scholarship_type}`);
      doc.text(`Status: ${app.status}`);
      doc.text(`Submitted: ${app.submitted_at}`);
      doc.moveDown();
    });

    doc.end();
  });
});

// ==================== REAL DATA CRAWLER IMPLEMENTATION ====================
const axios = require("axios");
const cheerio = require("cheerio");

// REAL websites for crawling actual scholarship data
const THREAD_SOURCES = [
  { 
    name: "Scholars4Dev", 
    url: "https://www.scholars4dev.com/category/scholarships/",
    selector: "h2.entry-title a",
    isReal: true
  },
  { 
    name: "OpportunityDesk", 
    url: "https://opportunitydesk.org/category/scholarships/",
    selector: "h2.entry-title a",
    isReal: true
  },
  { 
    name: "ScholarshipPositions", 
    url: "https://scholarship-positions.com/category/scholarship/",
    selector: "h2.entry-title a",
    isReal: true
  },
  { 
    name: "MLS Scholarships", 
    url: "https://www.mlsscholarships.com/",
    selector: "article h2 a",
    isReal: true
  }
];

// Distributed nodes with real API endpoints
const DISTRIBUTED_NODES = [
  { nodeId: "Node-1", endpoint: "https://www.scholars4dev.com/feed/", name: "Scholars4Dev RSS" },
  { nodeId: "Node-2", endpoint: "https://opportunitydesk.org/feed/", name: "OpportunityDesk RSS" },
  { nodeId: "Node-3", endpoint: "https://scholarship-positions.com/feed/", name: "ScholarshipPositions RSS" },
  { nodeId: "Node-4", endpoint: "https://www.scholarships.com/feed/", name: "ScholarshipsCom RSS" }
];

// Path to worker files
const workerFilePath = path.join(__dirname, 'crawler-worker.js');
const distributedFilePath = path.join(__dirname, 'distributed-crawler.js');

// Function to run distributed node
function runDistributedNode(node, keyword) {
  return new Promise((resolve) => {
    if (!fs.existsSync(distributedFilePath)) {
      resolve({ success: false, error: "distributed-crawler.js not found", node: node.name, data: [] });
      return;
    }
    
    const child = fork(distributedFilePath, [JSON.stringify({ node, keyword })], { silent: true });
    
    child.on('message', (message) => {
      resolve(message);
      child.kill();
    });
    
    child.on('error', (err) => {
      resolve({ success: false, error: err.message, node: node.name, data: [] });
    });
    
    setTimeout(() => {
      resolve({ success: false, error: "Timeout", node: node.name, data: [] });
      child.kill();
    }, 15000);
  });
}

// API: Start parallel crawler with REAL DATA
app.post("/api/crawl", upload.none(), async (req, res) => {
  const { keyword } = req.body;
  if (!keyword) {
    return res.status(400).json({ error: "Keyword is required" });
  }
  
  if (!fs.existsSync(workerFilePath)) {
    return res.status(500).json({ error: "crawler-worker.js not found. Please create it in the root folder." });
  }
  
  console.log(`\n🚀 ==========================================`);
  console.log(`🚀 STARTING REAL DATA PARALLEL CRAWLER`);
  console.log(`🚀 ==========================================`);
  console.log(`📌 Keyword: "${keyword}"`);
  console.log(`📌 Worker Threads: ${THREAD_SOURCES.length}`);
  console.log(`📌 Distributed Nodes: ${DISTRIBUTED_NODES.length}`);
  
  try {
    // Clear previous unsaved crawled scholarships
    await new Promise((resolve) => {
      db.run("DELETE FROM crawled_scholarships WHERE saved = 0", (err) => {
        if (err) console.error("Error clearing old crawls:", err.message);
        resolve();
      });
    });
    
    // ============ PART 1: WORKER THREADS (Real Websites) ============
    console.log("\n📌 [STEP 1] Starting REAL WEBSITE CRAWLERS...");
    const threadPromises = THREAD_SOURCES.map((source, index) => {
      return new Promise((resolve) => {
        const worker = new Worker(workerFilePath, {
          workerData: {
            source: source,
            keyword: keyword,
            threadId: index + 1
          }
        });
        
        worker.on('message', (result) => resolve(result));
        worker.on('error', (err) => resolve({ success: false, error: err.message, source: source.name, data: [] }));
        worker.on('exit', (code) => {
          if (code !== 0) resolve({ success: false, error: `Worker stopped with exit code ${code}`, source: source.name, data: [] });
        });
        
        setTimeout(() => resolve({ success: false, error: "Thread timeout", source: source.name, data: [] }), 15000);
      });
    });
    
    const threadResults = await Promise.all(threadPromises);
    const threadScholarships = [];
    threadResults.forEach(result => {
      if (result.success && result.data && result.data.length > 0) {
        threadScholarships.push(...result.data);
        console.log(`✅ ${result.source}: ${result.data.length} scholarships found`);
      } else if (result.error) {
        console.log(`❌ ${result.source}: ${result.error}`);
      }
    });
    
    console.log(`📊 Worker Threads total: ${threadScholarships.length} real scholarships`);
    
    // ============ PART 2: DISTRIBUTED NODES (RSS Feeds) ============
    console.log("\n📌 [STEP 2] Starting DISTRIBUTED RSS CRAWLERS...");
    const distributedPromises = DISTRIBUTED_NODES.map(node => runDistributedNode(node, keyword));
    const distributedResults = await Promise.all(distributedPromises);
    
    const distributedScholarships = [];
    distributedResults.forEach(result => {
      if (result.success && result.data && result.data.length > 0) {
        distributedScholarships.push(...result.data);
        console.log(`✅ ${result.node}: ${result.data.length} scholarships found`);
      } else if (result.error) {
        console.log(`❌ ${result.node}: ${result.error}`);
      }
    });
    
    console.log(`📊 Distributed Nodes total: ${distributedScholarships.length} real scholarships`);
    
    // ============ PART 3: Combine and Save ============
    const allScholarships = [...threadScholarships, ...distributedScholarships];
    
    console.log(`\n🎉 ==========================================`);
    console.log(`🎉 CRAWLING COMPLETE`);
    console.log(`🎉 ==========================================`);
    console.log(`📊 TOTAL REAL SCHOLARSHIPS FOUND: ${allScholarships.length}`);
    console.log(`   - From Websites: ${threadScholarships.length}`);
    console.log(`   - From RSS Feeds: ${distributedScholarships.length}`);
    
    // Save to database
    for (const sch of allScholarships) {
      await new Promise((resolve) => {
        const query = `INSERT INTO crawled_scholarships (title, description, eligibility, deadline, source_url, saved)
                       VALUES (?, ?, ?, ?, ?, 0)`;
        db.run(query, [
          sch.title || "Scholarship Opportunity",
          sch.description || "Check source website for details",
          sch.eligibility || "See source for eligibility criteria",
          sch.deadline || "Check source website",
          sch.source_url || "#"
        ], (err) => {
          if (err) console.error("Error saving:", err.message);
          resolve();
        });
      });
    }
    
    res.json({
      success: true,
      message: `Crawling complete! Found ${allScholarships.length} REAL scholarships from ${THREAD_SOURCES.length + DISTRIBUTED_NODES.length} parallel sources.`,
      count: allScholarships.length,
      worker_threads: THREAD_SOURCES.length,
      distributed_nodes: DISTRIBUTED_NODES.length,
      thread_results: threadScholarships.length,
      distributed_results: distributedScholarships.length,
      data_type: "REAL WEB DATA"
    });
    
  } catch (error) {
    console.error("Crawler error:", error);
    res.status(500).json({ error: "Crawler failed", details: error.message });
  }
});

// API: Get crawled scholarships
app.get("/api/crawled-scholarships", (req, res) => {
  db.all("SELECT * FROM crawled_scholarships WHERE saved = 0 ORDER BY crawled_at DESC", [], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows);
  });
});

// API: Save selected crawled scholarships
app.post("/api/save-crawled", upload.none(), (req, res) => {
  const { ids } = req.body;
  const idArray = ids.split(",").map(id => parseInt(id.trim())).filter(id => !isNaN(id));
  
  if (idArray.length === 0) {
    return res.status(400).json({ error: "No valid IDs provided" });
  }
  
  const placeholders = idArray.map(() => "?").join(",");
  
  db.all(`SELECT * FROM crawled_scholarships WHERE id IN (${placeholders}) AND saved = 0`, idArray, (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    
    if (rows.length === 0) {
      return res.status(404).json({ error: "No unsaved scholarships found" });
    }
    
    let savedToMain = 0;
    let completed = 0;
    
    rows.forEach((sch) => {
      const insertQuery = `INSERT INTO scholarships (title, description, eligibility, deadline, seats_left)
                           VALUES (?, ?, ?, ?, 10)`;
      
      db.run(insertQuery, [sch.title, sch.description, sch.eligibility, sch.deadline], function(err) {
        if (err) {
          console.error("Error saving to main table:", err.message);
        } else {
          savedToMain++;
        }
        
        db.run("UPDATE crawled_scholarships SET saved = 1 WHERE id = ?", [sch.id]);
        
        completed++;
        if (completed === rows.length) {
          res.json({
            success: true,
            message: `Saved ${savedToMain} out of ${rows.length} scholarships to main database.`
          });
        }
      });
    });
  });
});

// API: Delete a crawled scholarship
app.post("/api/delete-crawled", upload.none(), (req, res) => {
  const { id } = req.body;
  db.run("DELETE FROM crawled_scholarships WHERE id = ? AND saved = 0", [id], function(err) {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ success: true, message: "Deleted successfully" });
  });
});

// Start the server
app.listen(PORT, () => {
  console.log(`🚀 Server is running on http://localhost:${PORT}`);
});