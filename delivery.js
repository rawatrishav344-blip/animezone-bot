require("./delivery-bot-1");
require("./delivery-bot-2");

console.log("✅ All Delivery Bots Started");
const express = require("express");

const app = express();

app.get("/", (req, res) => {
  res.send("Delivery Bot Running");
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`Web server running on port ${PORT}`);
});
