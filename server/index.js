const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const { parse } = require('csv-parse/sync');
const nodemailer = require('nodemailer');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const app = express();
app.use(cors());
app.use(express.json());

const DATA_ROOT = process.env.DATA_DIR || __dirname;
const DATABASE_PATH = path.join(DATA_ROOT, 'data_files');
const UPLOAD_BASE_DIR = path.join(DATA_ROOT, 'uploads');
const DATABASE_JSON = path.join(DATA_ROOT, 'submissions.json');
const RESISTANCE_ANALYSIS_DIRNAME = '抗藥性分析';
const FUNGAMR_STATS_PATH = path.join(__dirname, 'reference', 'FungAMR統計表.csv');

const COUNTRY_HINTS = [
    ['United States', /\b(?:United States|USA|U\.S\.A?\.)\b/i],
    ['United Kingdom', /\b(?:United Kingdom|UK|England|Scotland|Wales)\b/i],
    ['South Korea', /\b(?:South Korea|Republic of Korea)\b/i],
    ['China', /\bChina\b/i],
    ['Canada', /\bCanada\b/i],
    ['Brazil', /\bBrazil\b/i],
    ['Japan', /\bJapan\b/i],
    ['Australia', /\bAustralia\b/i],
    ['Taiwan', /\bTaiwan\b/i],
    ['France', /\bFrance\b/i],
    ['Germany', /\bGermany\b/i],
    ['India', /\bIndia\b/i],
    ['Iran', /\bIran\b/i],
    ['Italy', /\bItaly\b/i],
    ['Netherlands', /\bNetherlands\b/i],
    ['Spain', /\bSpain\b/i],
    ['Turkey', /\bTurkey\b/i],
    ['Egypt', /\bEgypt\b/i],
];

function findCountryHint(...values) {
    const sourceText = values.filter(Boolean).join(' ');
    return COUNTRY_HINTS.find(([, pattern]) => pattern.test(sourceText))?.[0] || null;
}

function loadFungAmrAccessionIndex() {
    if (!fs.existsSync(FUNGAMR_STATS_PATH)) return new Map();

    const rows = parse(fs.readFileSync(FUNGAMR_STATS_PATH, 'utf8'), {
        columns: headers => headers.map((header, index) => header.trim() || `unnamed_${index}`),
        skip_empty_lines: true,
        bom: true,
        trim: true,
        relax_column_count: true,
    });

    return new Map(rows
        .filter(row => row.unnamed_0)
        .map(row => [String(row.unnamed_0).trim(), {
            accessionNumber: String(row.unnamed_0).trim(),
            year: Number(row.year) || null,
            drug: (row.drug || '').trim(),
            strainIds: (row.strain_ID || '').split(',').map(value => value.trim()).filter(Boolean),
            country: findCountryHint(row.notes, row.clinical_outcome),
            gene: (row['gene or protein name'] || '').trim(),
            mutation: (row.mutation || '').trim(),
        }]));
}

const FUNGAMR_ACCESSION_INDEX = loadFungAmrAccessionIndex();

/**
 * 讀取抗藥性報告（同時相容 .csv 與 .tsv 格式）
 */
function readResistanceReports(folderPath) {
    const analysisPath = path.join(folderPath, RESISTANCE_ANALYSIS_DIRNAME);
    fs.mkdirSync(analysisPath, { recursive: true });

    // 1. 同時比對 .csv 與 .tsv 報告檔案並複製至分析目錄
    fs.readdirSync(folderPath, { withFileTypes: true })
        .filter(entry => entry.isFile() && /_resistance_report.*\.(csv|tsv)$/i.test(entry.name))
        .forEach(entry => {
            fs.copyFileSync(
                path.join(folderPath, entry.name),
                path.join(analysisPath, entry.name)
            );
        });

    return fs.readdirSync(analysisPath)
        .filter(fileName => /_resistance_report.*\.(csv|tsv)$/i.test(fileName))
        .flatMap(fileName => {
            const fileContent = fs.readFileSync(path.join(analysisPath, fileName), 'utf8');
            const sampleName = fileName.replace(/_resistance_report.*$/i, '');

            // 2. 自動判斷分隔符號：若是 .tsv 檔或第一行含有 \t 則以 Tab 分隔，否則以逗號分隔
            const firstLine = fileContent.trim().split(/\r?\n/)[0] || '';
            const delimiter = fileName.toLowerCase().endsWith('.tsv') || firstLine.includes('\t') ? '\t' : ',';

            return parse(fileContent, {
                columns: headers => headers.map(header => header.trim()),
                skip_empty_lines: true,
                bom: true,
                trim: true,
                relax_column_count: true,
                delimiter: delimiter, // 動態指定分隔符號
            })
                .map(row => {
                    const resistantDrugs = (row.Resistant_Drugs || row.resistant_drugs || '')
                        .split(',')
                        .map(value => value.trim())
                        .filter(value => value && !/^none$/i.test(value));
                    const mutationSites = (row.Mutation_Site || row.mutation_site || '')
                        .split(',')
                        .map(value => value.trim())
                        .filter(value => value && !/^none$/i.test(value) && value !== '-');
                    const accessionNumbers = (row.Accession_Number || row.accession_number || '')
                        .split(',')
                        .map(value => value.trim())
                        .filter(value => value && !/^none$/i.test(value));

                    return {
                        sampleName,
                        gene: (row.Gene_Name || row.gene_name || row.gene || '').trim(),
                        reference: (row.Reference_Sequence || row.reference_sequence || row.reference || '').trim(),
                        mutationCombination: (row.Mutation_Combination || row.mutation_combination || '').trim(),
                        mutationSite: (row.Mutation_Site || row.mutation_site || '').trim(),
                        mutationSites,
                        resistantDrugs,
                        accessionNumbers,
                    };
                })
                .filter(record => record.gene && record.mutationSites.length);
        });
}

const SENDER_EMAIL = 'bioailab403@gmail.com';
const SMTP_USER = process.env.SMTP_USER || SENDER_EMAIL;
const SMTP_PORT = Number(process.env.SMTP_PORT || 465);
const mailTransporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST || 'smtp.gmail.com',
    port: SMTP_PORT,
    secure: process.env.SMTP_SECURE ? process.env.SMTP_SECURE === 'true' : SMTP_PORT === 465,
    auth: {
        user: SMTP_USER,
        pass: process.env.SMTP_PASS || '',
    },
});

function isEmailConfigured() {
    return Boolean(process.env.SMTP_PASS);
}

async function sendEmail(to, subject, text) {
    if (!isEmailConfigured()) return false;

    try {
        await mailTransporter.sendMail({
            from: `FungiGuard <${SENDER_EMAIL}>`,
            to,
            subject,
            text,
        });
        return true;
    } catch (error) {
        console.error('Email delivery failed:', error.message);
        return false;
    }
}

function getAvailableSpecies() {
    const databaseSpecies = fs.readdirSync(DATABASE_PATH, { withFileTypes: true })
        .filter(entry => entry.isDirectory() && !entry.name.startsWith('.'))
        .map(entry => entry.name);
    const submittedSpecies = Object.values(JSON.parse(fs.readFileSync(DATABASE_JSON, 'utf8')))
        .map(submission => submission.species)
        .filter(Boolean);

    return [...new Set(['Aspergillus fumigatus', ...databaseSpecies, ...submittedSpecies])].sort();
}

/**
 * 檢查資料夾內是否有分析報告（支援 .csv 與 .tsv）
 */
function hasResistanceReport(folderPath) {
    const searchPaths = [folderPath, path.join(folderPath, RESISTANCE_ANALYSIS_DIRNAME)]
        .filter(candidate => fs.existsSync(candidate));

    return searchPaths.some(candidate => fs.readdirSync(candidate, { withFileTypes: true })
        .some(entry => entry.isFile() && /_resistance_report.*\.(csv|tsv)$/i.test(entry.name)));
}

async function checkForCompletedAnalyses() {
    const submissions = JSON.parse(fs.readFileSync(DATABASE_JSON, 'utf8'));
    let changed = false;

    for (const [trackingId, submission] of Object.entries(submissions)) {
        const folderPath = path.join(UPLOAD_BASE_DIR, trackingId);
        if (!fs.existsSync(folderPath) || !hasResistanceReport(folderPath)) continue;

        const records = readResistanceReports(folderPath);
        let submissionChanged = false;
        if (submission.status !== '分析完成') {
            submission.status = '分析完成';
            submission.analysisCompletedAt = new Date().toISOString();
            submission.resistanceMutationCount = records.reduce((count, record) => count + record.mutationSites.length, 0);
            submissionChanged = true;
        }

        if (!submission.analysisCompletionEmailSent && submission.email) {
            const resistantCount = records.filter(record => record.resistantDrugs.length > 0).length;
            const sent = await sendEmail(
                submission.email,
                `FungiGuard 分析完成通知：${trackingId}`,
                [
                    `您好，Query ${trackingId} 的抗藥性分析已完成。`,
                    `物種：${submission.species}`,
                    `突變點位數：${submission.resistanceMutationCount ?? 0}`,
                    `有抗藥藥物標記的報告列：${resistantCount}`,
                    `採集地點：${submission.collectionLocation || '未提供'}`,
                ].join('\n')
            );
            if (sent) {
                submission.analysisCompletionEmailSent = true;
                submission.analysisCompletionEmailSentAt = new Date().toISOString();
                submissionChanged = true;
            }
        }

        if (submissionChanged) {
            fs.writeFileSync(path.join(folderPath, 'metadata.json'), JSON.stringify(submission, null, 2));
            changed = true;
        }
    }

    if (changed) {
        fs.writeFileSync(DATABASE_JSON, JSON.stringify(submissions, null, 2));
    }
}

// 初始化
if (!fs.existsSync(DATABASE_PATH)) fs.mkdirSync(DATABASE_PATH);
if (!fs.existsSync(UPLOAD_BASE_DIR)) fs.mkdirSync(UPLOAD_BASE_DIR);
if (!fs.existsSync(DATABASE_JSON)) fs.writeFileSync(DATABASE_JSON, JSON.stringify({}));

function generateLogicalID() {
    const now = new Date();
    const datePart = now.toISOString().split('T')[0].replace(/-/g, ''); // YYYYMMDD
    const timePart = now.toTimeString().split(' ')[0].replace(/:/g, ''); // HHMMSS
    
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let checkCode = '';
    for (let i = 0; i < 4; i++) {
        checkCode += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    
    return `FG-${datePart}-${timePart}-${checkCode}`;
}

const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        if (!req.trackingId) {
            req.trackingId = generateLogicalID();
        }
        
        const folderPath = path.join(UPLOAD_BASE_DIR, req.trackingId);
        if (!fs.existsSync(folderPath)) {
            fs.mkdirSync(folderPath, { recursive: true });
        }
        cb(null, folderPath);
    },
    filename: function (req, file, cb) {
        cb(null, file.originalname);
    }
});

const upload = multer({ storage: storage });

app.get('/api/species', (req, res) => {
    res.json({ species: getAvailableSpecies() });
});

app.get('/api/stats', (req, res) => {
    try {
        const items = fs.readdirSync(DATABASE_PATH);
        let speciesCount = 0;
        let totalSamples = 0;
        items.forEach(item => {
            const itemPath = path.join(DATABASE_PATH, item);
            if (!item.startsWith('.') && fs.statSync(itemPath).isDirectory()) {
                speciesCount++;
                const validSamples = fs.readdirSync(itemPath).filter(f => !f.startsWith('.'));
                totalSamples += validSamples.length;
            }
        });
        res.json({ speciesCount, sampleCount: totalSamples });
    } catch (err) {
        res.status(500).json({ error: "統計出錯" });
    }
});

app.post('/api/upload', (req, res, next) => {
    req.trackingId = generateLogicalID();
    next();
}, upload.single('geneFile'), async (req, res) => {
    const trackingId = req.trackingId;
    const email = (req.body.email || '').trim();
    const species = (req.body.species || '').trim();
    const ncbiAccession = (req.body.ncbiAccession || '').trim();
    const collectionLocation = (req.body.collectionLocation || '').trim();
    const hasFile = Boolean(req.file?.originalname && req.file.size > 0);
    if (req.file && !hasFile) {
        fs.rmSync(req.file.path, { force: true });
    }
    const reject = (message) => {
        if (req.file) {
            fs.rmSync(path.dirname(req.file.path), { recursive: true, force: true });
        }
        return res.status(400).json({ success: false, message });
    };

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        return reject('請輸入有效的 Email。');
    }
    if (!getAvailableSpecies().includes(species)) {
        return reject('請選擇資料庫已有的物種。');
    }
    if (!hasFile && !ncbiAccession) {
        return reject('上傳檔案與 NCBI 序號至少需填寫一項。');
    }

    const folderPath = path.join(UPLOAD_BASE_DIR, trackingId);
    fs.mkdirSync(folderPath, { recursive: true });
    const timestamp = new Date().toISOString();
    const submission = {
        id: trackingId,
        originalName: hasFile ? req.file.originalname : null,
        fileName: hasFile ? req.file.filename : null,
        ncbiAccession: ncbiAccession || null,
        email,
        species,
        collectionLocation,
        folderName: trackingId,
        filePath: hasFile ? req.file.path : null,
        status: '等待分析',
        timestamp,
        result: `已收到提交資料，Query 序號為 ${trackingId}。`,
        submissionEmailSent: false,
        analysisCompletionEmailSent: false,
    };

    fs.writeFileSync(path.join(folderPath, 'metadata.json'), JSON.stringify(submission, null, 2));
    const db = JSON.parse(fs.readFileSync(DATABASE_JSON, 'utf8'));
    db[trackingId] = submission;
    fs.writeFileSync(DATABASE_JSON, JSON.stringify(db, null, 2));

    submission.submissionEmailSent = await sendEmail(
        email,
        `FungiGuard 收件確認：${trackingId}`,
        [
            '您好，已成功收到您的樣本提交。',
            `上傳序號：${trackingId}`,
            `物種：${species}`,
            `NCBI 序號：${ncbiAccession || '未提供'}`,
            `上傳檔案：${hasFile ? req.file.originalname : '未提供'}`,
            `採集地點：${collectionLocation || '未提供'}`,
            '分析完成後會再寄送通知。',
        ].join('\n')
    );
    if (submission.submissionEmailSent) {
        submission.submissionEmailSentAt = new Date().toISOString();
        fs.writeFileSync(path.join(folderPath, 'metadata.json'), JSON.stringify(submission, null, 2));
        db[trackingId] = submission;
        fs.writeFileSync(DATABASE_JSON, JSON.stringify(db, null, 2));
    }

    // 同時支援 .csv 與 .tsv 的上傳檢查
    if (hasFile && /_resistance_report.*\.(csv|tsv)$/i.test(req.file.filename)) {
        await checkForCompletedAnalyses();
    }
    const latestSubmission = JSON.parse(fs.readFileSync(DATABASE_JSON, 'utf8'))[trackingId];

    res.json({
        success: true,
        trackingId,
        status: latestSubmission.status,
        emailSent: submission.submissionEmailSent,
        emailConfigured: isEmailConfigured(),
    });
});

app.get('/api/query/:id', (req, res) => {
    const trackingId = req.params.id;
    const db = JSON.parse(fs.readFileSync(DATABASE_JSON));
    const submission = db[trackingId];

    if (!submission) {
        return res.json({ success: false, message: '找不到此序號' });
    }

    const folderPath = path.join(UPLOAD_BASE_DIR, trackingId);
    
    let filesInFolder = [];
    let resistanceRecords = [];
    if (fs.existsSync(folderPath)) {
        filesInFolder = fs.readdirSync(folderPath, { withFileTypes: true })
            .filter(entry => entry.isFile() && !entry.name.startsWith('.') && entry.name !== 'metadata.json')
            .map(entry => entry.name);
        resistanceRecords = readResistanceReports(folderPath);
    }
    const accessionNumbers = new Set(resistanceRecords.flatMap(record => record.accessionNumbers || []));
    const accessionStats = [...accessionNumbers]
        .map(accessionNumber => FUNGAMR_ACCESSION_INDEX.get(accessionNumber))
        .filter(Boolean);

    res.json({ 
        success: true, 
        data: {
            ...submission,
            fileList: filesInFolder,
            resistanceFolder: RESISTANCE_ANALYSIS_DIRNAME,
            resistanceRecords,
            accessionStats,
            unmappedAccessionCount: accessionNumbers.size - accessionStats.length,
        } 
    });
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server is running on port ${PORT}`);
    checkForCompletedAnalyses().catch(error => console.error('Analysis completion scan failed:', error.message));
    setInterval(() => {
        checkForCompletedAnalyses().catch(error => console.error('Analysis completion scan failed:', error.message));
    }, 15000);
});