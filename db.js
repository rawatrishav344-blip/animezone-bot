const mongoose = require('mongoose');

// ⚠️ APNA asli password <db_password> ki jagah dalna
const MONGO_URI = "mongodb+srv://rawatrishav344_db_user:JkRMCPEDOK650JK3@cluster0.y9grler.mongodb.net/AnimeZoneDB?retryWrites=true&w=majority&appName=Cluster0";

mongoose.connect(MONGO_URI).then(() => console.log("✅ MongoDB Connected"));

const AppSchema = new mongoose.Schema({
  data: { type: Object, default: {} }
}, { minimize: false });

const AppModel = mongoose.model('AppData', AppSchema);

async function read() {
  let doc = await AppModel.findOne();
  if (!doc) {
    // Agar database khali hai toh naya banao
    doc = await AppModel.create({ data: { animeList: [], exclusiveContent: [], announcements: [], channels: [], config: { adminIds: [5840296032], darkCode: "00700" }, users: {} } });
  }
  return doc.data;
}

async function write(newData) {
  await AppModel.findOneAndUpdate({}, { data: newData }, { upsert: true });
}

async function update(mutateFn) {
  const data = await read();
  const result = mutateFn(data);
  await write(data);
  return result;
}

module.exports = { read, write, update };
