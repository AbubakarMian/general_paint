const express = require('express');
const { chromium } = require('playwright');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const { json } = require('stream/consumers');
const app = express();
const PORT = 5005;
app.use(cors());
let isStopped = false;
let browser = null;
let context;
let page = null;
let interceptedRequests = [];
const xlsx = require('xlsx');
const { createCanvas } = require('canvas');

async function loadUrl() {
    browser = await chromium.launch({
        headless: false,
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-blink-features=AutomationControlled',
            '--disable-dev-shm-usage',
            '--disable-gpu',
            '--window-size=1280,720'
        ]
    });
    context = await browser.newContext();
    page = await browser.newPage();
    await page.setExtraHTTPHeaders({
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
    });
    await page.goto('https://generalpaint.info/v2/site/login');
    await loginPage(page);


}
async function loginPage(page) {

    const usernameSelector = '#loginform-username';
    const passwordSelector = '#loginform-password';
    const submitSelector = "[name='login-button']";

    await page.waitForSelector(usernameSelector);
    await page.fill(usernameSelector, 'johnnybrownlee87');

    await page.waitForSelector(passwordSelector);
    await page.fill(passwordSelector, '7s1xpcnjqQ');
    // Click submit
    await page.waitForSelector(submitSelector);
    await Promise.all([
        page.click(submitSelector),
    ]);
}


function getRandomNumber(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
}

async function get_val(iframe, selector, tryies) {
    let text = await iframe.$eval(selector, el => el.innerText).catch(() => "");
    for (let i = 0; i < tryies && text == ""; i++) {
        text = await iframe.$eval(selector, el => el.innerText).catch(() => "");
        await page.waitForTimeout(1500);
    }
    return text;
}

app.get('/loadurl', async (req, res) => {
    try {
        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');
        res.flushHeaders();

        let url = req.query.url || '';
        res.write(`data: [Loading]\n\n`);

        await loadUrl();

        res.write(`data: [loadurlSuccess]\n\n`);
        res.end();
    } catch (error) {
        console.error(`Error in /demand_base route: ${error.message}`);
        // res.write(`data: ${JSON.stringify({ error: error.message })}\n\n`);
        res.write(`data: [ERROR]\n\n`);
        res.end();
    }
});

async function loadNewPage(sid, id, new_page) {
    {
        let load_url = 'https://generalpaint.info/v2/search/family?id=' + id + '&sid=' + sid;
        await new_page.goto(load_url);
        randomWaitTime = getRandomNumber(3500, 5500);
        await page.waitForTimeout(randomWaitTime);
        await new_page.waitForSelector('.container.mt-4');
        await downloadCanvasImage(new_page);
        const data = await new_page.evaluate(() => {
            const container = document.querySelector('.container.mt-4');
            if (!container) return null;
            const yearAndColor = container.querySelector('.formula-h2')?.innerHTML.trim() || null;
            const tone = container.querySelector('td span.formula-h2')?.innerText.trim() || null;
            const panelNo = container.querySelector('td span.formula-h2:nth-of-type(2)')?.innerText.trim() || null;
            const details = container.querySelector('td:nth-child(3)')?.innerHTML.trim() || null;
            const canvasWrapper = container.querySelector('#canvas_wrapper');
            const bgColor = canvasWrapper?.style.backgroundColor || null;
            return {
                yearAndColor,
                tone,
                panelNo,
                details,
                bgColor,
            };
        });

        console.log('Extracted Data:', data);
        if (data.bgColor) {
            const pngFileName = `paint/colors/${getRandomNumber(11111, 99999)}.png`;
            await saveColorAsPng(data.bgColor, pngFileName);
        }
        return data;
    }
}
async function downloadCanvasImage(page) {
    // const canvasXPath = 'xpath=//html/body/div/table/tbody/tr/td[1]/div/canvas';
    try {
        const canvas_wrapper = '#canvas_wrapper';
        await page.waitForSelector(canvas_wrapper, { timeout: 3000 });

        const canvasDataUrl = await page.evaluate((xpath) => {
            const canvas = document.evaluate(
                xpath,
                document,
                null,
                XPathResult.FIRST_ORDERED_NODE_TYPE,
                null
            ).singleNodeValue;

            if (!canvas) return null;

            // Get the image data URL from the canvas
            return canvas.toDataURL('image/png');
        }, canvas_wrapper);

        if (canvasDataUrl) {
            // Decode the Base64-encoded data URL
            const base64Data = canvasDataUrl.replace(/^data:image\/png;base64,/, '');

            // Save the image as a PNG file
            const fileName = 'canvas_image.png';
            fs.writeFileSync(fileName, base64Data, 'base64');
            console.log(`Canvas image saved as ${fileName}`);
        } else {
            console.log('Canvas element not found or unable to extract data URL.');
        }
    } catch (error) {

    }

}

async function loadFromPage(url, limit, page_num, res) {
    console.log("load from page ");
    let randomWaitTime = getRandomNumber(1500, 3500);
    await page.waitForTimeout(randomWaitTime);
    await page.waitForSelector('#make_dropdown');
    await page.selectOption('#make_dropdown', { index: 3 });
    const selectedValue = await page.evaluate(() => {
        const dropdown = document.getElementById('make_dropdown');
        return dropdown.value;
    });
    const submitButtonSelector = '.btn.btn-success.btn-lg.mr-3';
    await Promise.all([
        page.click(submitButtonSelector),
        // page.waitForNavigation(),
    ]);

    randomWaitTime = getRandomNumber(1500, 3500);
    await page.waitForTimeout(randomWaitTime);

    await page.waitForSelector('#digital_formula');

    // Get all `.root` elements inside `#digital_formula`
    const containers_details = await page.$$eval('#digital_formula > .root', (elements) => {
        return elements.map(el => {
            return {
                familyId: el.getAttribute('family_id'),
                sid: el.getAttribute('sid'),
                make: el.getAttribute('make'),
                description: el.getAttribute('desc'),
                url: el.getAttribute('url'),
                content: el.innerText.trim()
            };
        });
    });
    console.log('containers_details', containers_details);

    let data_arr = [];
    ///
    const new_page = await context.newPage(); // Opens a new tab within the same browser context

    console.log('tring to logged in again');
    await new_page.goto('https://generalpaint.info/v2/site/login');
    await loginPage(new_page);
    randomWaitTime = getRandomNumber(5500, 7500);
    await page.waitForTimeout(randomWaitTime);
    ///

    for (const container_item of containers_details) {
        let scraped_info = await loadNewPage(container_item.sid, container_item.familyId, new_page);
        data_arr.push(scraped_info);
    }
    await saveToExcel(data_arr, 'paint/paint.csv');
    // const containers = await page.$$('#digital_formula > .root'); // Get all parent divs with class 'root'

    // for (const container of containers) {
    //     // Check if any child has the 'formula-multitone-access' class
    //     const hasMultitoneAccess = await container.$('.formula-multitone-access');

    //     if (hasMultitoneAccess) {
    //         // console.log('Skipped container:', await container.evaluate(node => node.outerHTML));

    //     } else {
    //         // Click the button if 'formula-multitone-access' does not exist
    //         const button = await container.$('.btn.btn-bg-white.btn-secondary.mr-2.info-button');

    //     }
    // }

    // for (const el of await page.$$('#digital_formula > .root .btn.btn-bg-white.btn-secondary.mr-2.info-button')) {
    //     await el.click(); // Use Playwright's `click` method for interacting with the button
    // }

    return;

}


async function saveToExcel(dataArray, fileName) {
    const worksheet = xlsx.utils.json_to_sheet(dataArray);
    const workbook = xlsx.utils.book_new();
    xlsx.utils.book_append_sheet(workbook, worksheet, 'Paint Data');
    xlsx.writeFile(workbook, fileName);
    console.log(`Excel file saved as ${fileName}`);
}

// async function saveColorAsPng(color, fileName) {
//     const canvas = createCanvas(90, 80);
//     const ctx = canvas.getContext('2d');
//     ctx.fillStyle = color;
//     ctx.fillRect(0, 0, 90, 80);
//     const buffer = canvas.toBuffer('image/png');
//     fs.writeFileSync(fileName, buffer);
//     console.log(`PNG image saved as ${fileName}`);
// }


async function saveColorAsPng(color, fileName) {
    // Ensure the color is a proper string
    color = color.trim(); 

    console.log('color value is : ',color);
    const canvas = createCanvas(90, 80);
    const ctx = canvas.getContext('2d');

    // Set the fill style to the provided color
    ctx.fillStyle = color;

    // Fill the rectangle with the color
    ctx.fillRect(0, 0, 90, 80);

    // Save the canvas content to a PNG buffer
    const buffer = canvas.toBuffer('image/png');

    // Write the buffer to a file
    fs.writeFileSync(fileName, buffer);
    console.log(`PNG image saved as ${fileName}`);
}
app.get('/general_paint', async (req, res) => {
    try {
        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');
        res.flushHeaders();
        console.time("Execution Time");
        req.on('close', () => {
            console.log('Client disconnected.');
            isStopped = true;  // Set flag to stop scraping
            // browser.close();
        });

        let limit = parseInt(req.query.limit) || 50;
        let page = parseInt(req.query.start_page, 10) || 1;
        page = isNaN(page) ? 1 : page;
        let url = req.query.url || '';
        isStopped = false;
        res.write(`data: [loggingIn]\n\n`);

        await loadFromPage(url, limit, page, res);
        res.write(`data: [DONE]\n\n`);
        console.timeEnd("Execution Time");
        // res.end();
    } catch (error) {
        console.error(`Error in /general_paint route: ${error.message}`);
        res.write(`data: [ERROR]\n\n`);
        res.end();
    }
});

app.get('/stop_scraping', (req, res) => {
    isStopped = true;  // Set flag to stop scraping
    // browser.close();
    res.send({ message: "Scraping stopped" });
    res.end();
});

// app.listen(PORT, () => {
app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server is working `);
    // console.log(`Server is working / running on http://localhost:${PORT}`);
});