router.post("/profile/upload", upload.single("image"), async (req, res) => {
  // 🔥 MIGLIORIA 1 — validazione file
  if (!req.file) {
    return res.status(400).json({
      success: false,
      error: "Nessun file ricevuto"
    });
  }

  const alias = req.user.alias;
  const fileUrl = "/uploads/profile/" + req.file.filename;

  // 🔥 MIGLIORIA 2 — URL assoluto (usiamo la tua BASE_URL reale)
  const fullUrl = `https://winkwink-backend1-production.up.railway.app${fileUrl}`;

  await db.query(
    "UPDATE users SET profile_image_url = $1 WHERE alias = $2",
    [fullUrl, alias]
  );

  res.json({ success: true, url: fullUrl });
});

