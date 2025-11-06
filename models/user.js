const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
  userId: String,
  name: String,
  birthdate: String,
  gender: String,
  country: String,
  rank: { type: String, default: "Bronze" },
  salary: { type: Number, default: 100 },
  status: { type: String, default: "pending" }, // accepted / rejected / blacklist
});

module.exports = mongoose.model("User", userSchema);
