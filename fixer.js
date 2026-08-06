const fs = require('fs');
const axios = require('axios');
const FormData = require('form-data');

const BOT_TOKEN = "8663771330:AAGAqc2aep2tGKSLy-ZspnF97ZnYlC-kdyU";
const DB_PATH = "./data.json";

async function uploadToGraph(url) {
    try {
        const response = await axios.get(url, { responseType: 'stream' });
        const form = new FormData();
        form.append('file', response.data);
        const upload = await axios.post('https://graph.org/upload', form, {
            headers: form.getHeaders()
        });
        return `https://graph.org${upload.data[0].src}`;
    } catch (e) {
        return null;
    }
}

async function fix() {
    console.log("Checking data.json for broken links...");
    let data = JSON.parse(fs.readFileSync(DB_PATH, 'utf-8'));
    let count = 0;

    // Fix Anime Thumbnails
    for (let anime of data.animeList) {
        if (anime.thumbnail.includes("api.telegram.org")) {
            console.log(`Fixing poster for: ${anime.name}`);
            const newLink = await uploadToGraph(anime.thumbnail);
            if (newLink) { anime.thumbnail = newLink; count++; }
        }
        // Fix Episode Thumbnails
        for (let ep of anime.episodes) {
            if (ep.thumbnail.includes("api.telegram.org")) {
                const newLink = await uploadToGraph(ep.thumbnail);
                if (newLink) { ep.thumbnail = newLink; count++; }
            }
        }
    }
    
    fs.writeFileSync(DB_PATH, JSON.stringify(data, null, 2));
    console.log(`✅ Done! ${count} thumbnails fixed permanently.`);
    process.exit();
}

fix();
