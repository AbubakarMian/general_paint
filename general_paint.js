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

// async function loadNewPage(sid, id, new_page) {
async function scrapFormaulaDetailsData(sid, id) {

    let load_url = 'https://generalpaint.info/v2/search/family?id=' + id + '&sid=' + sid;
    console.log('scrapFormaulaDetailsDataUrl', load_url);
    await new_page.goto(load_url);// await new_page.goto(load_url, { waitUntil: 'domcontentloaded' });        
    randomWaitTime = getRandomNumber(3500, 5500);
    await new_page.goto(load_url);
    await new_page.waitForTimeout(randomWaitTime);
    console.log('step 2');
    // return {};
    await new_page.waitForSelector('.container.mt-4');
    await downloadSearchFamilyCanvasImage2(sid, id,new_page);
    // await downloadCanvasImage(new_page);
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

    console.log('scrapFormaulaDetailsData Extracted Data:', data);
    if (data.bgColor) {
        const pngFileName = `paint/colors/${getRandomNumber(11111, 99999)}.png`;
        await saveColorAsPng(data.bgColor, pngFileName);
    }
    return data;

}

async function downloadSearchFamilyCanvasImage2(sid, id, canvas_page) {
    console.log('starting downloadSearchFamilyCanvasImage2 sid', sid);
    console.log('starting downloadSearchFamilyCanvasImage2 id', id);

    const canvasImages = await canvas_page.evaluate(async () => {
        const images = [];
        const trElements = document.querySelectorAll('tbody tr');

        trElements.forEach((tr, index) => {
            const canvas = tr.querySelector('canvas');
            const div = tr.querySelector('#canvas_wrapper');

            if (canvas) {
                // If canvas exists, convert it to an image
                const image = canvas.toDataURL('image/png');
                images.push({ index, image });
            } else if (div) {
                // If no canvas but a div exists, create a canvas and draw the div's background color
                const canvasElement = document.createElement('canvas');
                const ctx = canvasElement.getContext('2d');

                // Set canvas dimensions to match the div
                canvasElement.width = div.offsetWidth;
                canvasElement.height = div.offsetHeight;

                // Get the background color of the div
                const bgColor = window.getComputedStyle(div).backgroundColor;

                // Draw the background color on the canvas
                ctx.fillStyle = bgColor;
                ctx.fillRect(0, 0, canvasElement.width, canvasElement.height);

                // Convert the canvas to an image
                const image = canvasElement.toDataURL('image/png');
                images.push({ index, image });
            }
        });

        return images;
    });

    console.log('entering loop');
    for (const { index, image } of canvasImages) {
        console.log('iterating loop ', index);

        let random_number = getRandomNumber(1000, 9999);
        const base64Data = image.replace(/^data:image\/png;base64,/, '');
        const imagePath = path.join('paint/colors', `${random_number}_${id}_${sid}_${index}.png`);

        fs.writeFileSync(imagePath, base64Data, 'base64', (err) => {
            if (err) console.error(`Error saving image ${index}:`, err);
            else console.log(`Image ${index} saved successfully!`);
        });
    }

    console.log('All images have been saved.');
    return true;
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
    if (data.bgColor) {
        const pngFileName = `paint/colors/${getRandomNumber(11111, 99999)}.png`;
        await saveColorAsPng(data.bgColor, pngFileName);
    }
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
    let randomWaitTime = getRandomNumber(1500, 3500);
    // let new_page = await context.newPage();
    // await new_page.goto('https://generalpaint.info/v2/site/login');
    // await loginPage(new_page);
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
    console.log('containers_details 1', containers_details);
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

            // Parse the URL and ID from the onclick value
            const urlAndIdMatch = onclickValue.match(/formulaInfo\(event,'([^']+)','([^']+)'\)/);
            if (urlAndIdMatch && urlAndIdMatch[1] && urlAndIdMatch[2]) {
                const url = urlAndIdMatch[1]; // Extracted URL
                const id = urlAndIdMatch[2];  // Extracted ID
                console.log('Extracted URL:', url);
                console.log('Extracted ID:', id);
                infoColorUrl = `https://generalpaint.info/v2/search/formula-info?id=${id}`;
                detailColorUrl = `https://generalpaint.info/v2/search/family?id=${container.familyId}&sid=${container.sid}`;
                console.log('infoColorUrl:', infoColorUrl);
                console.log('detailColorUrl:', detailColorUrl);
                await scrapFormaulaDetailsData(container.sid, container.familyId);
                // await scrapColorInfoData(id);
                // infoColorUrl = 'https://generalpaint.info/v2/search/formula-info?id=107573';
                // detailColorUrl = 'https://generalpaint.info/v2/search/family?id=67746&sid=67d00e248ae305.41320823';
            } else {
                console.error('Failed to extract URL and ID from onclick value');
            }

            // randomWaitTime = getRandomNumber(5500, 7500);
            // await page.waitForTimeout(randomWaitTime);


            // for (const container_item of containers_details) {
            //     let scraped_info = await loadNewPage(container_item.sid, container_item.familyId, new_page);
            //     data_arr.push(scraped_info);
            // }
        }

        {
            // let iframeColorInfo = await getColorInfo(page, i);
            // containers_details[i] = {
            //     ...container,
            //     iframeColorInfo
            // };
            // console.log('iframeColorInfo 2', iframeColorInfo);
            // let iframeFormulaDetails = await getFormulaDetails(page, i);
            // containers_details[i] = {
            //     ...container,
            //     iframeFormulaDetails
            // };


            // return;
            //     // Wait for the button to be visible and enabled
            //     await page.waitForSelector('#digital_formula > .root button[data-original-title="Color Information"]', {
            //         state: 'visible',
            //         timeout: 30000
            //     });
            //     console.log('Clicking button...');
            //     await buttons[i].click();
            //     console.log('Waiting for modal...');
            //     await page.waitForSelector('#formulaInfo.modal.fade.show', { timeout: 30000 });
            //     const iframeSelector = `iframe[src^="/v2/search/formula-info?id="]`;
            //     console.log('Waiting for iframe...');
            //     // await page.waitForSelector(iframeSelector, { timeout: 30000 });

            //     // Add a random wait time to ensure the iframe is fully loaded
            //     const randomWaitTime = getRandomNumber(3500, 5500);
            //     console.log(`Waiting for ${randomWaitTime}ms...`);
            //     await page.waitForTimeout(randomWaitTime);
            //     const iframeHandle = await page.$(iframeSelector);
            //     const iframeContent = await iframeHandle.contentFrame();
            //     const iframeHTML = await iframeContent.evaluate(() => document.documentElement.outerHTML);
            //     // console.log('Iframe HTML:', iframeHTML);
            //     await iframeContent.waitForFunction(() => {
            //         // Check if a specific element (e.g., .col-sm-5) is present and has content
            //         const manufacturer = document.querySelector('.col-sm-5');
            //         return manufacturer && manufacturer.innerText.trim() !== '';
            //     }, { timeout: 30000 });
            //     console.log('Extracting data from iframe...');
            //     let iframeData = {};
            //     try {
            //         iframeData = await iframeContent.evaluate(() => {
            //             console.log('iframeDataiframeDataiframeData...'); // Debugging log
            //             const manufacturer = document.querySelector('.col-sm-5')?.innerText || '';
            //             const colorCode = document.querySelectorAll('.col-sm-5')[1]?.innerText || '';
            //             const colorDescription = document.querySelectorAll('.col-sm-7')[0]?.innerText || '';
            //             const year = document.querySelectorAll('.col-sm-6')[0]?.innerText || '';
            //             // const models = Array.from(document.querySelectorAll('#models tbody tr')).map(row => ({
            //             //     model: row.querySelector('td')?.innerText || '',
            //             //     startYear: row.querySelectorAll('td')[1]?.innerText || '',
            //             //     endYear: row.querySelectorAll('td')[2]?.innerText || ''
            //             // }));
            //             const canvasWrapper = document.querySelector('#canvas_wrapper');
            //             const backgroundColor = canvasWrapper ? window.getComputedStyle(canvasWrapper).backgroundColor : '';

            //             return {
            //                 manufacturer,
            //                 colorCode,
            //                 colorDescription,
            //                 year,
            //                 // models,
            //                 // model: row.querySelector('td')?.innerText || '',
            //                 // startYear: row.querySelectorAll('td')[1]?.innerText || '',
            //                 // endYear: row.querySelectorAll('td')[2]?.innerText || '',
            //                 // backgroundColor
            //             };
            //         });
            //     } catch (error) {
            //         console.error('Error extracting data from iframe:', error);
            //         // iframeData = {
            //         //     manufacturer: iframeHTML.match(/<div class="col-sm-5">([^<]+)<\/div>/)?.[1]?.trim() || '',
            //         //     colorCode: iframeHTML.match(/<div class="col-sm-5">([^<]+)<\/div>/g)?.[1]?.match(/<div class="col-sm-5">([^<]+)<\/div>/)?.[1]?.trim() || '',
            //         //     colorDescription: iframeHTML.match(/<div class="col-sm-7">([^<]+)<\/div>/)?.[1]?.trim() || '',
            //         //     year: iframeHTML.match(/<div class="col-sm-6">([^<]+)<\/div>/)?.[1]?.trim() || '',
            //         //     models: Array.from(iframeHTML.matchAll(/<tr start="(\d+)" end="(\d+)">\s*<td>([^<]+)<\/td>\s*<td>([^<]+)<\/td>\s*<td>([^<]+)<\/td>\s*<\/tr>/g)).map(match => ({
            //         //         model: match[3]?.trim() || '',
            //         //         startYear: match[1]?.trim() || '',
            //         //         endYear: match[2]?.trim() || ''
            //         //     })),
            //         //     backgroundColor: iframeHTML.match(/background-color:\s*([^;]+);/)?.[1]?.trim() || ''
            //         // };
            //     }

            //     // Merge the extracted data with the container object
            //     containers_details[i] = {
            //         ...container,
            //         ...iframeData
            //     };
            //     const closebuttons = await page.$$('#formulaInfo .close');
            //     console.log('Number of close buttons:', closebuttons.length);

            //     if (closebuttons.length > 0) {
            //         console.log('Starting close loop...');
            //         for (let i = 0; i < closebuttons.length; i++) {
            //             console.log(`Processing close button ${i}...`);

            //             // Check if the close button is visible and enabled
            //             const isVisible = await closebuttons[i].isVisible();
            //             console.log(`Close button ${i} is visible:`, isVisible);

            //             const isEnabled = await closebuttons[i].isEnabled();
            //             console.log(`Close button ${i} is enabled:`, isEnabled);

            //             if (isVisible && isEnabled) {
            //                 // Scroll the button into view
            //                 await closebuttons[i].scrollIntoViewIfNeeded();
            //                 console.log('Close button scrolled into view.');

            //                 // Click the button using evaluate
            //                 await page.evaluate((button) => button.click(), closebuttons[i]);
            //                 console.log('Close button clicked using evaluate.');
            //             } else {
            //                 console.error(`Close button ${i} is not visible or enabled.`);
            //             }
            //         }
            //     } else {
            //         console.error('No close buttons found!');
            //     }
            // }
        }
    }


    console.log('containers_details 2', containers_details);


    let data_arr = [];
    ///
    // const new_page = await context.newPage(); // Opens a new tab within the same browser context

    // console.log('tring to logged in again');
    // await new_page.goto('https://generalpaint.info/v2/site/login');

    ////tttt
    // await loginPage(new_page);
    // randomWaitTime = getRandomNumber(5500, 7500);
    // await page.waitForTimeout(randomWaitTime);


    // for (const container_item of containers_details) {
    //     let scraped_info = await loadNewPage(container_item.sid, container_item.familyId, new_page);
    //     data_arr.push(scraped_info);
    // }


    ///end ttttt/
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
async function getFormulaDetails(page, i) {
    return {};
}

async function saveToExcel(dataArray, fileName) {
    const worksheet = xlsx.utils.json_to_sheet(dataArray);
    const workbook = xlsx.utils.book_new();
    xlsx.utils.book_append_sheet(workbook, worksheet, 'Paint Data');
    xlsx.writeFile(workbook, fileName);
    console.log(`Excel file saved as ${fileName}`);
}
function saveBase64Image(base64Data, filePath) {
    const base64Image = base64Data.split(';base64,').pop(); // Remove the data URL prefix
    fs.writeFileSync(filePath, base64Image, { encoding: 'base64' });
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
    return;
    // Ensure the color is a proper string
    color = color.trim();

    console.log('color value is : ', color);
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