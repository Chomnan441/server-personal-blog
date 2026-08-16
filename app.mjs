import "dotenv/config";
import express from "express";
import cors from "cors";
import postsRouter from "./routes/posts.mjs";
import authRouter from "./routes/auth.mjs";
import categoriesRouter from "./routes/categories.mjs";
import notificationsRouter from "./routes/notifications.mjs";
import siteSettingsRouter from "./routes/siteSettings.mjs";
import protectUser from "./middlewares/protectUser.mjs";
import protectAdmin from "./middlewares/protectAdmin.mjs";
import { ensureNotificationsTable } from "./utils/notifications.mjs";
import { ensureSiteSettingsTable } from "./utils/siteSettings.mjs";

const app = express();
const port = process.env.PORT || 4000;

function buildCorsOrigins() {
  const defaults = [
    "http://localhost:5173",
    "http://localhost:3000",
  ];

  const fromEnv = [
    process.env.FRONTEND_URL,
    ...(process.env.CORS_ORIGINS || "").split(","),
  ]
    .map((value) => (typeof value === "string" ? value.trim() : ""))
    .filter(Boolean);

  return [...new Set([...defaults, ...fromEnv])];
}

app.use(express.json({ limit: "1mb" }));

app.use(
  cors({
    origin: buildCorsOrigins(),
  }),
);

app.get("/health", (req, res) => {
  res.status(200).json({ message: "OK" });
});

app.use("/posts", postsRouter);
app.use("/auth", authRouter);
app.use("/categories", categoriesRouter);
app.use("/notifications", notificationsRouter);
app.use("/site-settings", siteSettingsRouter);

app.get("/protected-route", protectUser, (req, res) => {
  res.status(200).json({
    message: "This is protected content",
    user: req.user,
  });
});

app.get("/admin-only", protectAdmin, (req, res) => {
  res.status(200).json({
    message: "This is admin-only content",
    admin: req.user,
  });
});

async function bootstrapTables() {
  try {
    await ensureNotificationsTable();
    console.log("Notifications table is ready");
  } catch (error) {
    console.error("Could not ensure notifications table:", error.message);
  }

  try {
    await ensureSiteSettingsTable();
    console.log("Site settings table is ready");
  } catch (error) {
    console.error("Could not ensure site_settings table:", error.message);
  }
}

// Vercel serverless: ต้อง export app — ห้าม app.listen
// Local: listen ตามปกติ
if (process.env.VERCEL) {
  bootstrapTables().catch((error) => {
    console.error("Bootstrap failed:", error.message);
  });
} else {
  app.listen(port, async () => {
    await bootstrapTables();
    console.log(`Server is running at http://localhost:${port}`);
  });
}

export default app;
