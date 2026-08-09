const mongoose = require('mongoose');

// ⚠️ APNA asli password <db_password> ki jagah dalna
const MONGO_URI = "mongodb+srv://rawatrishav344_db_user:JkRMCPEDOK650JK3@cluster0.y9grler.mongodb.net/AnimeZoneDB?retryWrites=true&w=majority&appName=Cluster0";

mongoose.connect(MONGO_URI).then(() => console.log("✅ MongoDB Connected"));

const AppSchema = new mongoose.Schema({
  data: { type: mongoose.Schema.Types.Mixed, default: {} }
}, { minimize: false });

const AppModel = mongoose.model('AppData', AppSchema);

const DEFAULT_DATA = {
  animeList: [],
  exclusiveContent: [],
  announcements: [],
  channels: [],
  deliveryBots: [],
  config: { adminIds: [5840296032], darkCode: "00700" },
  users: {}
};

async function read() {
  let doc = await AppModel.findOne();
  if (!doc) {
    // Agar database khali hai toh naya banao
    doc = await AppModel.create({ data: DEFAULT_DATA });
  }

  // Purane document mein agar koi field missing ho (jaise deliveryBots),
  // usko default value se bhar do taaki crash na ho
  let healed = false;
  for (const key of Object.keys(DEFAULT_DATA)) {
    if (doc.data[key] === undefined) {
      doc.data[key] = DEFAULT_DATA[key];
      healed = true;
    }
  }
  if (healed) {
    doc.markModified('data');
    await doc.save();
  }

  return doc.data;
}

async function write(newData) {
  let doc = await AppModel.findOne();
  if (!doc) {
    doc = new AppModel({ data: newData });
  } else {
    doc.data = newData;
  }
  doc.markModified('data');
  await doc.save();
}

async function update(mutateFn) {
  let doc = await AppModel.findOne();
  if (!doc) {
    doc = await AppModel.create({ data: DEFAULT_DATA });
  }
  const result = await mutateFn(doc.data);
  doc.markModified('data');
  await doc.save();
  return result;
}

module.exports = { read, write, update };
