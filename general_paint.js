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
let new_page = null;
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

    new_page = await context.newPage();
    await new_page.goto('https://generalpaint.info/v2/site/login');
    await loginPage(new_page);
    randomWaitTime = getRandomNumber(7500, 9500);
    await new_page.waitForTimeout(randomWaitTime);


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

async function scrapFormaulaDetailsData(sid, id) {
    let load_url = 'https://generalpaint.info/v2/search/family?id=' + id + '&sid=' + sid;
    console.log('scrapFormaulaDetailsDataUrl', load_url);
    await new_page.goto(load_url);
    randomWaitTime = getRandomNumber(3500, 5500);
    await new_page.goto(load_url);
    await new_page.waitForTimeout(randomWaitTime);
    console.log('step 2');
    await new_page.waitForSelector('.container.mt-4');

    // Step 1: Download images and get the paths
    let color_paths = await downloadSearchFamilyCanvasImage(sid, id, new_page);

    // Step 2: Scrape other details and pass color_paths as an argument
    const data = await new_page.evaluate((color_paths) => {
        const results = [];

        // Extract year and color from the top section
        const formulaH2 = document.querySelector('.formula-h2');
        const yearColorText = formulaH2 ? formulaH2.innerText.trim() : '';
        const [year, color] = yearColorText.split('\n').map((text) => text.trim());

        // Extract details from the button
        const detailsElement = document.querySelector('.formula-info');
        const details = detailsElement ? detailsElement.getAttribute('data-original-title') : '';

        // Loop through each row in the table
        const trElements = document.querySelectorAll('tbody tr');
        trElements.forEach((tr, index) => {
            // Extract tone
            const toneElement = Array.from(tr.querySelectorAll('.formula-h1'))
                .find(el => el.innerText.includes('Tone'))
                ?.nextElementSibling;
            const tone = toneElement ? toneElement.innerText.trim() : '';

            // Extract panel number
            const panelNoElement = Array.from(tr.querySelectorAll('.formula-h1'))
                .find(el => el.innerText.includes('Panel no.'))
                ?.nextElementSibling;
            const panelNo = panelNoElement ? panelNoElement.innerText.trim() : '';

            // Extract background color from the canvas or div
            const canvasWrapper = tr.querySelector('#canvas_wrapper');
            let bgColor = '';

            if (canvasWrapper) {
                const canvas = canvasWrapper.querySelector('canvas');
                if (canvas) {
                    const ctx = canvas.getContext('2d');
                    const imageData = ctx.getImageData(0, 0, 1, 1).data; // Get pixel data from the top-left corner
                    bgColor = `rgba(${imageData[0]}, ${imageData[1]}, ${imageData[2]}, ${imageData[3] / 255})`;
                } else {
                    bgColor = window.getComputedStyle(canvasWrapper).backgroundColor;
                }
            }

            // Add the data for this row to the results array
            results.push({
                year,
                color,
                tone,
                panelNo,
                details,
                bgColor,
                image_path: color_paths[index] || null, // Use the corresponding image path
            });
        });

        return results;
    }, color_paths); // Pass color_paths as an argument to evaluate

    console.log('scrapFormaulaDetailsData Extracted Data:', data);
    return data;
}



// async function loadNewPage(sid, id, new_page) {
async function scrapFormaulaDetailsData_d(sid, id) {

    let load_url = 'https://generalpaint.info/v2/search/family?id=' + id + '&sid=' + sid;
    console.log('scrapFormaulaDetailsDataUrl', load_url);
    await new_page.goto(load_url);// await new_page.goto(load_url, { waitUntil: 'domcontentloaded' });        
    randomWaitTime = getRandomNumber(3500, 5500);
    await new_page.goto(load_url);
    await new_page.waitForTimeout(randomWaitTime);
    console.log('step 2');
    await new_page.waitForSelector('.container.mt-4');
    let color_paths = await downloadSearchFamilyCanvasImage(sid, id, new_page);
    const data = await new_page.evaluate((color_paths) => {
        const formulaH2 = document.querySelector('.formula-h2');
        const yearColorText = formulaH2 ? formulaH2.innerText.trim() : '';
        const [year, color] = yearColorText.split('\n').map((text) => text.trim());
        const toneElement = Array.from(document.querySelectorAll('.formula-h1'))
            .find(el => el.innerText.includes('Tone'))
            ?.nextElementSibling;
        const tone = toneElement ? toneElement.innerText.trim() : '';
        const panelNoElement = Array.from(document.querySelectorAll('.formula-h1'))
            .find(el => el.innerText.includes('Panel no.'))
            ?.nextElementSibling;
        const panelNo = panelNoElement ? panelNoElement.innerText.trim() : '';
        const detailsElement = document.querySelector('.formula-info');
        const details = detailsElement ? detailsElement.getAttribute('data-original-title') : '';
        const canvasWrapper = document.querySelector('#canvas_wrapper');
        let bgColor = '';

        if (canvasWrapper) {
            const canvas = canvasWrapper.querySelector('canvas');
            if (canvas) {
                const ctx = canvas.getContext('2d');
                const imageData = ctx.getImageData(0, 0, 1, 1).data; // Get pixel data from the top-left corner
                bgColor = `rgba(${imageData[0]}, ${imageData[1]}, ${imageData[2]}, ${imageData[3] / 255})`;
            } else {
                bgColor = window.getComputedStyle(canvasWrapper).backgroundColor;
            }
        }

        return {
            year,
            color,
            tone,
            panelNo,
            details,
            bgColor,
            color_paths
        };
    }, color_paths);

    console.log('scrapFormaulaDetailsData Extracted Data:', data);
    return data;

}

async function downloadSearchFamilyCanvasImage(sid, id, canvas_page) {
    console.log('starting downloadSearchFamilyCanvasImage2 sid', sid);

    const canvasImages = await canvas_page.evaluate(async () => {
        const images = [];
        const trElements = document.querySelectorAll('tbody tr');

        trElements.forEach((tr, index) => {
            const canvas = tr.querySelector('canvas');
            const div = tr.querySelector('#canvas_wrapper');

            if (canvas) {
                const image = canvas.toDataURL('image/png');
                images.push({ index, image });
            } else if (div) {
                const canvasElement = document.createElement('canvas');
                const ctx = canvasElement.getContext('2d');
                canvasElement.width = div.offsetWidth;
                canvasElement.height = div.offsetHeight;
                const bgColor = window.getComputedStyle(div).backgroundColor;
                ctx.fillStyle = bgColor;
                ctx.fillRect(0, 0, canvasElement.width, canvasElement.height);
                const image = canvasElement.toDataURL('image/png');
                images.push({ index, image });
            }
        });

        return images;
    });

    console.log('entering loop');
    let images_arr = [];
    for (const { index, image } of canvasImages) {
        console.log('iterating loop ', index);
        let random_number = getRandomNumber(1000, 9999);
        const base64Data = image.replace(/^data:image\/png;base64,/, '');
        let imagePath = path.join('paint/colors', `${random_number}_${id}_${sid}_${index}.png`);
        images_arr.push(imagePath);
        fs.writeFileSync(imagePath, base64Data, 'base64', (err) => {
            if (err) console.error(`Error saving image ${index}:`, err);
            else console.log(`Image ${index} saved successfully!`);
        });
    }

    console.log('All images have been saved.');
    return images_arr;
}

async function scrapColorInfoData(id) {
    let load_url = 'https://generalpaint.info/v2/search/formula-info?id=' + id;
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
    // if (data.bgColor) {
    //     const pngFileName = `paint/colors/${getRandomNumber(11111, 99999)}.png`;
    //     await saveColorAsPng(data.bgColor, pngFileName);
    // }
    return data;
}

async function downloadCanvasImage(canvas_page) {
    // const canvasXPath = 'xpath=//html/body/div/table/tbody/tr/td[1]/div/canvas';
    try {
        const canvas_wrapper = '#canvas_wrapper';
        await canvas_page.waitForSelector(canvas_wrapper, { timeout: 3000 });

        const canvasDataUrl = await canvas_page.evaluate((xpath) => {
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
            const fileName = 'canvas_image.png';
            fs.writeFileSync(fileName, base64Data, 'base64');
            console.log(`Canvas image saved as ${fileName}`);
        } else {
            console.log('Canvas element not found or unable to extract data URL.');
        }
    } catch (error) {

    }

}

async function loadFromPage(res) {
    console.log("load from page ");
    let data_arr = [];
    let randomWaitTime = getRandomNumber(1500, 3500);
    await page.waitForTimeout(randomWaitTime);
    await page.waitForSelector('#make_dropdown');
    await page.selectOption('#make_dropdown', { index: 1 });
    const selectedValue = await page.evaluate(() => {
        const dropdown = document.getElementById('make_dropdown');
        return dropdown.value;
    });
    const submitButtonSelector = '.btn.btn-success.btn-lg.mr-3';
    await Promise.all([
        page.click(submitButtonSelector),
    ]);

    randomWaitTime = getRandomNumber(1500, 3500);
    await page.waitForTimeout(randomWaitTime);

    await page.waitForSelector('#digital_formula');
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
    
    for (let i = 0; i < containers_details.length; i++) {
        const container = containers_details[i];
        const containerHandles = await page.$$('#digital_formula > .root');
        const hasMultitoneAccess = await containerHandles[i].$('.formula-multitone-access');
        let infoColorUrl = '';
        let detailColorUrl = '';
        if (hasMultitoneAccess) {
            console.log('multi tone found');
            continue;
        }
        // Get the button for the current element
        const buttons = await page.$$('#digital_formula > .root button[data-original-title="Color Information"]');
        if (buttons[i]) {
            console.log(`Processing container ${i}`);
            await buttons[i].scrollIntoViewIfNeeded();
            const onclickValue = await buttons[i].evaluate(button => button.getAttribute('onclick'));
            console.log('onclick value:', onclickValue);

            const urlAndIdMatch = onclickValue.match(/formulaInfo\(event,'([^']+)','([^']+)'\)/);
            if (urlAndIdMatch && urlAndIdMatch[1] && urlAndIdMatch[2]) {
                const url = urlAndIdMatch[1]; 
                const id = urlAndIdMatch[2];
                let scrap_details = await scrapFormaulaDetailsData(container.sid, container.familyId);
                for (const scrap_detail of scrap_details) {
                    let combinedData = { ...container, ...scrap_detail };
                    data_arr.push(combinedData);
                }
                infoColorUrl = `https://generalpaint.info/v2/search/formula-info?id=${id}`;
                detailColorUrl = `https://generalpaint.info/v2/search/family?id=${container.familyId}&sid=${container.sid}`;
                console.log('infoColorUrl:', infoColorUrl);
                console.log('detailColorUrl:', detailColorUrl);

                // await scrapColorInfoData(id);
                // infoColorUrl = 'https://generalpaint.info/v2/search/formula-info?id=107573';
                // detailColorUrl = 'https://generalpaint.info/v2/search/family?id=67746&sid=67d00e248ae305.41320823';
            } else {
                console.error('Failed to extract URL and ID from onclick value');
            }
        }
   
    }

    console.log('final scraped data data',data_arr);
    await saveToExcel(data_arr, 'paint/paint.csv');
    return;

}

async function getColorInfo(page, i) {
    const buttons = await page.$$('#digital_formula > .root button[data-original-title="Color Information"]');
    let iframeData = {};
    if (buttons[i]) {
        console.log(`Processing container ${i}`);

        await buttons[i].scrollIntoViewIfNeeded();
        await page.waitForSelector('#digital_formula > .root button[data-original-title="Color Information"]', {
            state: 'visible',
            timeout: 30000
        });
        await buttons[i].click();
        await page.waitForSelector('#formulaInfo.modal.fade.show', { timeout: 30000 });
        const iframeSelector = `iframe[src^="/v2/search/formula-info?id="]`;
        const randomWaitTime = getRandomNumber(3500, 5500);
        await page.waitForTimeout(randomWaitTime);
        const iframeHandle = await page.$(iframeSelector);
        const iframeContent = await iframeHandle.contentFrame();

        // Wait for the specific element to be present and have content
        await iframeContent.waitForFunction(() => {
            const manufacturer = document.querySelector('.col-sm-5');
            return manufacturer && manufacturer.innerText.trim() !== '';
        }, { timeout: 30000 });

        try {
            iframeData = await iframeContent.evaluate(() => {
                console.log('step 1 ...'); // Debugging log
                const manufacturer = document.querySelector('.col-sm-5')?.innerText || '';
                const colorCode = document.querySelectorAll('.col-sm-5')[1]?.innerText || '';
                const colorDescription = document.querySelectorAll('.col-sm-7')[0]?.innerText || '';
                const year = document.querySelectorAll('.col-sm-6')[0]?.innerText || '';
                const canvasWrapper = document.querySelector('#canvas_wrapper');
                const backgroundColor = canvasWrapper ? window.getComputedStyle(canvasWrapper).backgroundColor : '';
                let carColor = '';
                const canvas = document.querySelector('#canvas_wrapper canvas');

                if (canvas) {
                    const imageDataURL = canvas.toDataURL('image/png'); // Get image as base64 data URL
                    carColor = imageDataURL; // Return the base64 data URL
                } else {
                    console.log('canvas not found');
                }

                return {
                    manufacturer,
                    colorCode,
                    colorDescription,
                    year,
                    backgroundColor,
                    carColor,
                };
            });

            await iframeContent.waitForFunction(() => {
                const canvas = document.querySelector('#canvas_wrapper canvas');
                if (!canvas) return false; // Canvas doesn't exist
                const context = canvas.getContext('2d');
                const imageData = context.getImageData(0, 0, canvas.width, canvas.height).data;
                return imageData.some(channel => channel !== 0); // Check if canvas has non-transparent pixels
            }, { timeout: 30000 });

            const canvas = document.querySelector('#canvas_wrapper canvas');
            if (canvas) {
                console.log('Canvas dimensions:', canvas.width, canvas.height); // Debug canvas size
                const imageDataURL = canvas.toDataURL('image/png');
                console.log('Image Data URL:', imageDataURL); // Debug the data URL
                carColor = imageDataURL;
            } else {
                console.log('Canvas not found');
            }

            // Save the image in the Node.js context
            if (iframeData.carColor) {
                console.log('iframe data obj', iframeData);
                const base64Data = iframeData.carColor.replace(/^data:image\/png;base64,/, '');
                const uniqueFileName = `${iframeData.manufacturer}_${iframeData.colorCode}_${Date.now()}.png`;
                const filePath = path.join('paint', 'colors', uniqueFileName);

                // Ensure the `paint/colors` directory exists
                fs.mkdirSync(path.join('paint', 'colors'), { recursive: true });

                // Write the file
                fs.writeFileSync(filePath, base64Data, 'base64');
                console.log(`Image saved to: ${filePath}`);

                // Update the `carColor` property to the file path
                iframeData.carColor = filePath;
            }
            else {

            }
        } catch (error) {
            console.error('Error extracting data from iframe:', error);
        }

        const closebuttons = await page.$$('#formulaInfo .close');

        if (closebuttons.length > 0) {
            for (let i = 0; i < closebuttons.length; i++) {
                const isVisible = await closebuttons[i].isVisible();
                const isEnabled = await closebuttons[i].isEnabled();
                if (isVisible && isEnabled) {
                    await closebuttons[i].scrollIntoViewIfNeeded();
                    await page.evaluate((button) => button.click(), closebuttons[i]);
                } else {
                    // console.error(`Close button ${i} is not visible or enabled.`);
                }
            }
        } else {
            console.error('No close buttons found!');
        }
    }

    console.log('before return ', iframeData);
    return iframeData;
}

async function saveToExcel(dataArray, fileName) {
    const worksheet = xlsx.utils.json_to_sheet(dataArray);
    const workbook = xlsx.utils.book_new();
    xlsx.utils.book_append_sheet(workbook, worksheet, 'Paint Data');
    xlsx.writeFile(workbook, fileName);
    console.log(`Excel file saved as ${fileName}`);
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

        isStopped = false;
        res.write(`data: [loggingIn]\n\n`);

        await loadFromPage(res);

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