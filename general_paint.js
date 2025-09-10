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
let multitone_page = null;
let filters_obj = {};
let interceptedRequests = [];
let _models_drop_down = [];
const xlsx = require('xlsx');
const { createCanvas } = require('canvas');
let current_filter_csv = 'paint/current_filter_csv.csv';
let all_completed_filter_csv = 'paint/all_completed_filter_csv.csv';

const MAX_RECURSION_DEPTH = 15;
const MAX_VISITED_ENTRIES = 1500000;
let visitedMultitones = new Set();
let currentRecursionDepth = 0;


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
    randomWaitTime = getRandomNumber(1500, 3500);
    await new_page.waitForTimeout(randomWaitTime);

    multitone_page = await context.newPage();
    await multitone_page.goto('https://generalpaint.info/v2/site/login');
    // await loginPage(multitone_page);
    // randomWaitTime = getRandomNumber(7500, 9500);
    // await multitone_page.waitForTimeout(randomWaitTime);


}


async function loginPage(page) {
    const LOGIN_URL = 'https://generalpaint.info/v2/site/login';
    const SEARCH_URL = 'https://generalpaint.info/v2/search';
    const LOGOUT_SELECTOR = 'form[action*="/v2/site/logout"]';

    // Check if we're already logged in
    try {
        // First ensure we're on a valid page
        if (!page.url().startsWith('https://generalpaint.info/v2/')) {
            await page.goto(SEARCH_URL, { waitUntil: 'domcontentloaded' });
        }

        // Look for either logout form or user profile indicator
        await page.waitForSelector(LOGOUT_SELECTOR, { timeout: 9000 });
        console.log('Already logged in');
        return;
    } catch {
        console.log('Not logged in - proceeding with login');
    }

    // If we're not on login page, go there
    // if (!page.url().includes('/site/login')) {
    //     await page.goto(LOGIN_URL, { waitUntil: 'domcontentloaded' });
    // }

    // Perform login
    const usernameSelector = '#loginform-username';
    const passwordSelector = '#loginform-password';
    const submitSelector = "[name='login-button']";

    try {
        await page.waitForSelector(usernameSelector, { timeout: 10000 });
        await page.fill(usernameSelector, 'johnnybrownlee87');

        await page.waitForSelector(passwordSelector, { timeout: 10000 });
        await page.fill(passwordSelector, '7s1xpcnjqQ');

        // Click submit and wait for navigation
        await Promise.all([
            page.waitForNavigation({ waitUntil: 'networkidle', timeout: 15000 }),
            page.click(submitSelector),
        ]);

        // Verify successful login
        try {
            await page.waitForSelector(LOGOUT_SELECTOR, { timeout: 5000 });
            console.log('Login successful');
        } catch {
            console.error('Login failed:', error);
            // throw new Error('Login verification failed - logout selector not found');
        }
    } catch (error) {
        console.error('Login failed:', error);
        // throw error; // Re-throw to handle in calling function
    }
}


function getRandomNumber(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
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
    await new_page.goto(load_url);
    randomWaitTime = getRandomNumber(3500, 5500);
    await new_page.waitForTimeout(randomWaitTime);
    await new_page.waitForSelector('.container.mt-4');
    let color_paths = await downloadSearchFamilyCanvasImage(sid, id, new_page);
    const data = await new_page.evaluate((color_paths) => {
        const results = [];
        const formulaH2 = document.querySelector('.formula-h2');
        const yearColorText = formulaH2 ? formulaH2.innerText.trim() : '';
        const [year, color] = yearColorText.split('\n').map((text) => text.trim());
        const detailsElement = document.querySelector('.formula-info');
        const details = detailsElement ? detailsElement.getAttribute('data-original-title') : '';
        const trElements = document.querySelectorAll('tbody tr');
        trElements.forEach((tr, index) => {
            const toneElement = Array.from(tr.querySelectorAll('.formula-h1'))
                .find(el => el.innerText.includes('Tone'))
                ?.nextElementSibling;
            const tone = toneElement ? toneElement.innerText.trim() : '';
            let panelNoElement = Array.from(tr.querySelectorAll('.formula-h1'))
                .find(el => el.innerText.includes('Panel no.'))
                ?.nextElementSibling;
            let panelNo = panelNoElement ? panelNoElement.innerText.trim() : '';
            if (!panelNo) {

            }
            console.log('panel no ', panelNo);
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

    return data;
}

async function downloadSearchFamilyCanvasImage(sid, id, canvas_page) {
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
    let images_arr = [];
    for (const { index, image } of canvasImages) {
        let random_number = getRandomNumber(10000, 99999);
        let uniq_name = getUniqueName(`${random_number}_${id}_${sid}_${index}.png`);
        const base64Data = image.replace(/^data:image\/png;base64,/, '');
        let color_path = await getColorPath();

        let imagePath = path.join(color_path, uniq_name);
        // let imagePath = path.join('paint/colors', `${random_number}_${id}_${sid}_${index}.png`);
        images_arr.push(imagePath);
        fs.writeFileSync(imagePath, base64Data, 'base64', (err) => {
            if (err) console.error(`Error saving image ${index}:`, err);
            // else console.log(`Image ${index} saved successfully!`);
        });
    }
    return images_arr;
}
function getUniqueName(baseName) {
    const timestamp = new Date().getTime(); // Current time in milliseconds
    return `${timestamp}_${baseName}`;
}

async function getColorPath() {
    const makeDropdown = await get_make_drop_down();
    const yearDropdown = await get_year_drop_down();
    const modelDropdown = _models_drop_down;
    const relatedColorsDropdown = await get_related_colors_drop_down();
    const colorFamilyDropdown = await get_color_family_drop_down();
    const solidEffectDropdown = await get_solid_effect_drop_down();

    const color_path = path.join(
        'paint',
        'colors',
        makeDropdown[filters_obj.make],
        yearDropdown[filters_obj.year],
        modelDropdown[filters_obj.model],
        relatedColorsDropdown[filters_obj.plastic_parts],
        colorFamilyDropdown[filters_obj.groupdesc],
        solidEffectDropdown[filters_obj.effect]
    );
    await fs.promises.mkdir(color_path, { recursive: true });
    return color_path;
}

async function scrapColorInfoData(id) {
    let load_url = 'https://generalpaint.info/v2/search/formula-info?id=' + id;
    await new_page.goto(load_url);
    randomWaitTime = getRandomNumber(3500, 5500);
    await page.waitForTimeout(randomWaitTime);
    await new_page.waitForSelector('.container.mt-4');
    await downloadSearchFamilyCanvasImage(new_page);
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
    return data;
}

async function setSearchFilters(selected_page, description = null) {

    filters_obj.description = description;
    let filters = filters_obj;

    await loginPage(selected_page);

    for (let try_to_load = 0; try_to_load < 5; try_to_load++) {
        try {
            console.log('setSearchFilters filters', filters);

            let randomWaitTime = getRandomNumber(1000, 1500);

            await selected_page.waitForSelector('#make_dropdown', { timeout: 5000 });

            if (filters.make != null) {
                await selected_page.selectOption('#make_dropdown', { index: filters.make });
                await get_model_drop_down(selected_page, filters);
            }
            if (filters.year != null) {
                await selected_page.selectOption('#year', { index: filters.year });
            }
            if (filters.plastic_parts != null) {
                // clear selections
                await selected_page.selectOption('#plastic_parts', []);
                if (filters.plastic_parts > 2) {
                    await selected_page.selectOption('#plastic_parts', { index: filters.plastic_parts - 1 });
                }

                /////

//                 await selected_page.evaluate(() => {
//   const select = document.querySelector('#plastic_parts');
//   if (select) {
//     [...select.options].forEach(opt => opt.selected = false);
//     $(select).selectpicker('refresh'); // important for bootstrap-select UI
//   }
// });

// // Now select only one option
// if (filters.plastic_parts > 2) {
//   await selected_page.selectOption('#plastic_parts', { index: filters.plastic_parts - 1 });
//   // Refresh UI again so bootstrap-select reflects the change
//   await selected_page.evaluate(() => {
//     $('#plastic_parts').selectpicker('refresh');
//   });
// }
            }
            if (filters.groupdesc != null) {
                await selected_page.selectOption('#groupdesc', { index: filters.groupdesc });
            }
            if (filters.effect != null) {
                await selected_page.selectOption('#effect', { index: filters.effect });
            }
            if (filters.description != null) {
                await selected_page.fill('#description', filters.description);
            }

            await selected_page.waitForTimeout(500);

            await selected_page.click('.btn.btn-success.btn-lg.mr-3');

            await selected_page.waitForTimeout(randomWaitTime);
            return; // ✅ success, exit function
        } catch (error) {
            console.error('Error in setSearchFilters attempt', try_to_load + 1, ':', error);
            await selected_page.goto('https://generalpaint.info/v2/search');
            await loginPage(selected_page);
            await selected_page.waitForTimeout(5000);
            continue; // ✅ retry next loop
        }
    }
    return;
}
async function setSearchFilters_d(selected_page, description = null) {
    await loginPage(selected_page);
    for (let try_to_load = 0; try_to_load < 5; try_to_load++) {
        try {
            filters_obj.description = description;
            let filters = filters_obj;

            console.log('setSearchFilters filters', filters_obj);
            let randomWaitTime = getRandomNumber(1000, 1500);

            // await selected_page.waitForSelector('#make_dropdown');
            await selected_page.waitForSelector('#make_dropdown', { timeout: 5000 });
            if (filters.make !== null) {
                await selected_page.selectOption('#make_dropdown', { index: filters.make });
                await get_model_drop_down(selected_page, filters);
            }
            if (filters.year !== null) {
                await selected_page.selectOption('#year', { index: filters.year });
            }
            if (filters.plastic_parts !== null) {
                await selected_page.evaluate(() => {
                    const selectElement = document.querySelector('#plastic_parts');
                    for (let option of selectElement.options) {
                        option.selected = false;
                    }
                });
                // if (filters.plastic_parts !== 0) {
                if (filters.plastic_parts > 2) {
                    await selected_page.selectOption('#plastic_parts', { index: (filters.plastic_parts - 1) });
                }
            }
            if (filters.groupdesc !== null) {
                await selected_page.selectOption('#groupdesc', { index: filters.groupdesc });
            }
            if (filters.effect !== null) {
                await selected_page.selectOption('#effect', { index: filters.effect });
            }
            if (filters.description !== null) {
                await selected_page.fill('#description', filters.description);
            }
            await selected_page.waitForTimeout(500);

            let submitButtonSelector = '.btn.btn-success.btn-lg.mr-3';
            await Promise.all([
                selected_page.click(submitButtonSelector),
            ]);

            await selected_page.waitForTimeout(randomWaitTime);
            return;
        } catch (error) {
            console.error('Error in setSearchfilter 1 :', error);
            await selected_page.goto('https://generalpaint.info/v2/search');
            await loginPage(selected_page);
            console.error('Error in setSearchfilter 2 :');
            await selected_page.waitForTimeout(5000);
            console.error('Error in setSearchfilter 3 :');


        }
    }
}

const getCurrentPageNumber = async (nextpage) => {
    try {
        const activePageItem = await nextpage.$('.pagination li.active');
        if (!activePageItem) {
            return 1;
        }
        else {
            const pageNumber = await page.evaluate(el => {
                const link = el.querySelector('a.page-link');
                return link ? parseInt(link.textContent, 10) : null;
            }, activePageItem);

            return pageNumber;
        }
    } catch (error) {
        console.error('Error in getCurrentPageNumber page number:', error);
        return 1;
        throw error;
    }
};
const goToNextPage = async (page) => {
    try {
        // Get the active page item
        const activePageItem = await page.$('.pagination li.active');
        if (!activePageItem) {
            console.log('No active page found');
            return false;
        }

        // Get the next page item
        const nextPageItem = await activePageItem.evaluateHandle(el => el.nextElementSibling);
        const nextPageElement = await nextPageItem.asElement();

        // If no next sibling exists, we're on the last page
        if (!nextPageElement) {
            console.log('Already on last page - no next sibling');
            return false;
        }

        // Check if the next item is actually a page item (not some other element)
        const isPageItem = await nextPageElement.evaluate(el => el.classList.contains('page-item'));
        if (!isPageItem) {
            console.log('Next element is not a page item');
            return false;
        }

        // Click the next page link
        const nextPageLink = await nextPageElement.$('a.page-link');
        if (!nextPageLink) {
            console.log('No page link found in next item');
            return false;
        }

        await Promise.all([
            nextPageLink.click(),
            // page.waitForNavigation({ waitUntil: 'networkidle0' })
        ]);

        // Verify we have content on the new page
        // await page.waitForSelector('#digital_formula', { timeout: 10000 });
        await has_digital_formula(page, '#digital_formula');

        return true;

    } catch (error) {
        console.error('Error navigating to next page:', error.message);
        return false;
    }
};


async function get_make_drop_down() {
    return [//248
        "Manufacturer", "ACURA", "AFNOR", "AIWAYS", "AIXAM", "ALFA ROMEO", "ALPINE", "AMERICAN MOTORS", "APRILIA MOTO", "ARO", "ASIA", "ASTON MARTIN", "AUDI", "AVATR", "BAIC", "BEDFORD", "BELLIER", "BENELLI MOTO", "BENTLEY", "BERKLEY", "BERLIET", "BERTONE", "BMW", "BMW MOTO", "BORGWARD", "BRILLIANCE", "BS2660", "BS381C", "BS4800", "BS5252", "BUERSTNER", "BUGATTI", "BYD AUTO", "CASALINI", "CATERHAM CARS", "CHANGAN", "CHATENET", "CHERY", "CHEVROLET EUR_", "CHRYSLER", "CITROEN", "CLUB CAR", "COMM_VEH_USA", "DACIA", "DAEWOO", "DAEWOO IRAN", "DAF TRUCKS", "DAIHATSU", "DANEMARK STAND", "DATSUN", "DENZA", "DERBI MOTO", "DHL EXPRESS", "DKW", "DONGFENG AUTO", "DR AUTOMOBILES", "DR MOTOR COMPANY", "DUCATI MOTO", "EDSEL", "ERF", "FACEL VEGA", "FAW HONGQI", "FCS", "FERRARI", "FIAT_LANCIA", "FINLANDE STAN", "FISKER", "FLEET", "FLEET GERMANY", "FLEET_AUSTRALIA", "FLEET_FRANCE", "FLEET_SAUDI AR", "FLEET_SPAIN", "FLEET_UK", "FORD EUROPE", "FORD_S_AFRICA", "FORD_USA", "FORD_AUSTRALIA", "FOTON", "FREIGHTLINER", "FSO", "GAC MOTOR", "GAT", "GAZ", "GEELY", "GENERAL MOTORS", "GEO", "GILERA MOTORCYCLES", "GREATWALL AUTO", "GROOVE", "HAFEI", "HAIMA", "HANOMAG", "HARLEY_DAVIDSON", "HAVAL", "HIPHI", "HKS", "HOLDEN", "HONDA", "HONDA MOTO", "HOZON AUTO", "HUMMER", "HYCAN", "HYUNDAI", "IM MOTORS", "INEOS AUTOMOTIVE", "INFINITI", "INNOCENTI", "ISUZU", "IVECO", "JAC MOTORS", "JAGUAR", "JENSEN", "JETOUR", "KARMA AUTO", "KAWASAKI MOTO", "KIA", "KTM MOTO", "KYMCO MOTO", "LADA", "LAMBORGHINI", "LAMBRETTA", "LAND ROVER", "LATAMMO MOTO", "LDV", "LEADING IDEAL", "LEAP MOTOR", "LEVDEO", "LEXUS", "LEYLAND", "LI AUTO", "LIFAN", "LIGIER", "LML", "LONDON ELECTRIC VEHICLE C", "LONDON TAXI", "LOTUS", "LUCID MOTORS", "LUXGEN", "LYNK AND CO", "MAGIRUS", "MAHINDRA", "MALAGUTI MOTO", "MAN", "MARUTI", "MASERATI", "MATRA", "MAZDA", "MCLAREN", "MERCEDES", "MERCEDES TRUCKS", "MG", "MICROCAR", "MIDDLEBRIDGE", "MINI", "MITSUBISHI", "MITSUBISHI TRUCKS", "MORGAN", "MOSKVITCH", "MOTO GUZZI MOTORCYCLES", "MOTORCYCLES", "NAVISTAR", "NCS", "NIO", "NISSAN", "NISSAN S_AFRICA", "NORMAS UNE", "ODA", "OPEL S_AFRICA", "OPEL_VAUXHALL", "OTHER", "PANHARD", "PANTONE", "PERODUA", "PEUGEOT", "PEUGEOT MOTO", "PIAGGIO MOTO", "POLESTAR", "POLESTONES", "PORSCHE", "PRIMER", "PROTON", "QOROS", "RAL", "RAL DESIGN", "RELIANT", "RENAULT", "RENAULT TRUCKS", "RIVIAN", "ROEWE", "ROLLS ROYCE", "ROOTES", "ROVER", "ROX", "SAAB", "SAIC_GM", "SAIPA", "SAMSUNG", "SANTANA", "SCANIA TRUCKS", "SEAT", "SERES", "SETRA", "SINOTRUK", "SKODA", "SKYWELL", "SMART", "SOUEAST", "SPECTRUM", "SSANGYONG", "STUDEBAKER", "SUBARU", "SUZUKI", "SUZUKI MOTO", "SWM MOTORS", "TALBOT", "TATA", "TATRA TRUCKS", "TESLA MOTORS", "TOYOTA", "TOYOTA S_AFRICA", "TOYOTA TRUCKS", "TRABANT", "TRIUMPH", "TRIUMPH MOTO", "TVR", "UAZ", "UMM", "VESPA", "VOLGA", "VOLKSWAGEN", "VOLVO", "VOLVO TRUCKS", "VORTEX", "VOYAH", "VSLF_USVC", "VW BRAZIL", "VW SHANGHAI", "WARTBURG", "WEY", "WM MOTOR", "WULING", "XPENG MOTORS", "YAMAHA MOTO", "YUGO", "ZAZ", "ZEEKR", "ZOTYE"
        // "Manufacturer", "ACURA", "AFNOR" //"AIWAYS", "AIXAM", "ALFA ROMEO", "ALPINE", "AMERICAN MOTORS", "APRILIA MOTO", "ARO", "ASIA", "ASTON MARTIN", "AUDI", "AVATR", "BAIC", "BEDFORD", "BELLIER", "BENELLI MOTO", "BENTLEY", "BERKLEY", "BERLIET", "BERTONE", "BMW", "BMW MOTO", "BORGWARD", "BRILLIANCE", "BS2660", "BS381C", "BS4800", "BS5252", "BUERSTNER", "BUGATTI", "BYD AUTO", "CASALINI", "CATERHAM CARS", "CHANGAN", "CHATENET", "CHERY", "CHEVROLET EUR.", "CHRYSLER", "CITROEN", "CLUB CAR", "COMM.VEH.USA", "DACIA", "DAEWOO", "DAEWOO IRAN", "DAF TRUCKS", "DAIHATSU", "DANEMARK STAND", "DATSUN", "DENZA", "DERBI MOTO", "DHL EXPRESS", "DKW", "DONGFENG AUTO", "DR AUTOMOBILES", "DR MOTOR COMPANY", "DUCATI MOTO", "EDSEL", "ERF", "FACEL VEGA", "FAW HONGQI", "FCS", "FERRARI", "FIAT/LANCIA", "FINLANDE STAN", "FISKER", "FLEET", "FLEET GERMANY", "FLEET-AUSTRALIA", "FLEET-FRANCE", "FLEET-SAUDI AR", "FLEET-SPAIN", "FLEET-UK", "FORD EUROPE", "FORD-S.AFRICA", "FORD-USA", "FORD_AUSTRALIA", "FOTON", "FREIGHTLINER", "FSO", "GAC MOTOR", "GAT", "GAZ", "GEELY", "GENERAL MOTORS", "GEO", "GILERA MOTORCYCLES", "GREATWALL AUTO", "GROOVE", "HAFEI", "HAIMA", "HANOMAG", "HARLEY-DAVIDSON", "HAVAL", "HIPHI", "HKS", "HOLDEN", "HONDA", "HONDA MOTO", "HOZON AUTO", "HUMMER", "HYCAN", "HYUNDAI", "IM MOTORS", "INEOS AUTOMOTIVE", "INFINITI", "INNOCENTI", "ISUZU", "IVECO", "JAC MOTORS", "JAGUAR", "JENSEN", "JETOUR", "KARMA AUTO", "KAWASAKI MOTO", "KIA", "KTM MOTO", "KYMCO MOTO", "LADA", "LAMBORGHINI", "LAMBRETTA", "LAND ROVER", "LATAMMO MOTO", "LDV", "LEADING IDEAL", "LEAP MOTOR", "LEVDEO", "LEXUS", "LEYLAND", "LI AUTO", "LIFAN", "LIGIER", "LML", "LONDON ELECTRIC VEHICLE C", "LONDON TAXI", "LOTUS", "LUCID MOTORS", "LUXGEN", "LYNK AND CO", "MAGIRUS", "MAHINDRA", "MALAGUTI MOTO", "MAN", "MARUTI", "MASERATI", "MATRA", "MAZDA", "MCLAREN", "MERCEDES", "MERCEDES TRUCKS", "MG", "MICROCAR", "MIDDLEBRIDGE", "MINI", "MITSUBISHI", "MITSUBISHI TRUCKS", "MORGAN", "MOSKVITCH", "MOTO GUZZI MOTORCYCLES", "MOTORCYCLES", "NAVISTAR", "NCS", "NIO", "NISSAN", "NISSAN S.AFRICA", "NORMAS UNE", "ODA", "OPEL S.AFRICA", "OPEL/VAUXHALL", "OTHER", "PANHARD", "PANTONE", "PERODUA", "PEUGEOT", "PEUGEOT MOTO", "PIAGGIO MOTO", "POLESTAR", "POLESTONES", "PORSCHE", "PRIMER", "PROTON", "QOROS", "RAL", "RAL DESIGN", "RELIANT", "RENAULT", "RENAULT TRUCKS", "RIVIAN", "ROEWE", "ROLLS ROYCE", "ROOTES", "ROVER", "ROX", "SAAB", "SAIC-GM", "SAIPA", "SAMSUNG", "SANTANA", "SCANIA TRUCKS", "SEAT", "SERES", "SETRA", "SINOTRUK", "SKODA", "SKYWELL", "SMART", "SOUEAST", "SPECTRUM", "SSANGYONG", "STUDEBAKER", "SUBARU", "SUZUKI", "SUZUKI MOTO", "SWM MOTORS", "TALBOT", "TATA", "TATRA TRUCKS", "TESLA MOTORS", "TOYOTA", "TOYOTA S.AFRICA", "TOYOTA TRUCKS", "TRABANT", "TRIUMPH", "TRIUMPH MOTO", "TVR", "UAZ", "UMM", "VESPA", "VOLGA", "VOLKSWAGEN", "VOLVO", "VOLVO TRUCKS", "VORTEX", "VOYAH", "VSLF/USVC", "VW BRAZIL", "VW SHANGHAI", "WARTBURG", "WEY", "WM MOTOR", "WULING", "XPENG MOTORS", "YAMAHA MOTO", "YUGO", "ZAZ", "ZEEKR", "ZOTYE"
    ];
}

async function get_model_drop_down(selected_page = null, filters) {
    let randomWaitTime = getRandomNumber(2500, 3500);
    await selected_page.waitForTimeout(randomWaitTime);
    let models = [];
    if (selected_page && filters.model !== null) {
        models = await selected_page.$$eval('#models_dropdown option', options =>
            options.map(o => o.textContent.trim())
        );
        // await selected_page.selectOption('#models_dropdown', { index: filters.model });


        // await selected_page.click('button[data-id="models_dropdown"]');
    await selected_page.waitForTimeout(randomWaitTime);
        console.log('models selection : ', filters.model);
        console.log('all models selection : ', models);
        await selected_page.selectOption('#models_dropdown', { index: filters.model });
        // await selected_page.click(`.dropdown-menu .dropdown-item >> text="${filters.model}"`);
    
    }
    console.log(models);
    _models_drop_down = models;
    return models;
}

async function get_year_drop_down() {
    return [ // 109
        "Year", "2027", "2026", "2025", "2024", "2023", "2022", "2021", "2020", "2019", "2018", "2017", "2016", "2015", "2014", "2013", "2012", "2011", "2010", "2009", "2008", "2007", "2006", "2005", "2004", "2003", "2002", "2001", "2000", "1999", "1998", "1997", "1996", "1995", "1994", "1993", "1992", "1991", "1990", "1989", "1988", "1987", "1986", "1985", "1984", "1983", "1982", "1981", "1980", "1979", "1978", "1977", "1976", "1975", "1974", "1973", "1972", "1971", "1970", "1969", "1968", "1967", "1966", "1965", "1964", "1963", "1962", "1961", "1960", "1959", "1958", "1957", "1956", "1955", "1954", "1953", "1952", "1951", "1950", "1949", "1948", "1947", "1946", "1945", "1944", "1943", "1942", "1941", "1940", "1939", "1938", "1937", "1936", "1935", "1934", "1933", "1932", "1931", "1930", "1929", "1928", "1927", "1926", "1925", "1924", "1923", "1922", "1921", "1920"
    ];
}
async function get_related_colors_drop_down() {
    return [//13 "Related Colors", 
        "Bumper", "Chassis", "Door Window", "Interior", "Multitone", "Roof", "Stripe", "Underhood", "Wheel", "Door Handle", "Grill Radiator", "Mirror", "Trim"
    ];
}
async function get_color_family_drop_down() {
    return [//13
        // "Color Family", "BEIGE", "BLACK", "BLANK", "BLUE", "BROWN", "GREEN", "GREY", "ORANGE", "RED", "VIOLET", "WHITE", "YELLOW"
        "Color Family", "BEIGE", "BLACK", "BLANK", "BLUE", "BROWN", "GREEN", "GREY", "ORANGE", "RED", "VIOLET", "WHITE", "YELLOW"
    ];
}
async function get_solid_effect_drop_down() {
    return [//3
        "Solid and Effect", "Solid", "Effect"
    ];
}
const writeCurrentRowToCsv = (row) => {
    const csvFilePath = current_filter_csv;
    const header = 'Make Index,Make,Year Index,Year,Model Index,Model,Related Colors Index,Related Colors,Color Family Index,Color Family,Solid Effect Index,Solid Effect\n';
    const csvContent = header + row; // Overwrite the file with the header and current row
    fs.writeFileSync(csvFilePath, csvContent);
};


const appendCurrentRowToCsv = (row) => {
    const csvFilePath = all_completed_filter_csv;
    const fileExists = fs.existsSync(csvFilePath);
    if (!fileExists) {
        const header = 'Make Index,Make,Year Index,Year,Model Index,Model,Related Colors Index,Related Colors,Color Family Index,Color Family,Solid Effect Index,Solid Effect\n';
        fs.writeFileSync(csvFilePath, header); // Write the header
    }
    fs.appendFileSync(csvFilePath, row);
};
const readLastRowFromCsv = (csvFilePath) => {
    if (!fs.existsSync(csvFilePath)) {
        return null; // File doesn't exist
    }

    const data = fs.readFileSync(csvFilePath, 'utf8');
    const rows = data.trim().split('\n');

    if (rows.length <= 1) {
        return null; // Only header or empty file
    }

    const lastRow = rows[rows.length - 1]; // Get the last row
    return lastRow.split(','); // Split the row into columns
};

async function loadFromPage(res) {
    console.log(`step 2 `);

    let make_drop_down = await get_make_drop_down();
    let year_drop_down = await get_year_drop_down();
    
    let model_drop_down = [];
    let related_colors_drop_down = await get_related_colors_drop_down();
    let color_family_drop_down = await get_color_family_drop_down();
    let solid_effect_drop_down = await get_solid_effect_drop_down();
    const lastRow = readLastRowFromCsv(current_filter_csv);
    let make_drop_down_index = 1;//0
    let year_drop_down_index = 1;//0
    let model_drop_down_index = 0;
    let related_colors_drop_down_index = 0;
    let color_family_drop_down_index = 0;
    let solid_effect_drop_down_index = 0;
    // let starting_from_csv_skip_loop = false;
    if (lastRow) {
        make_drop_down_index = parseInt(lastRow[0]);
        year_drop_down_index = parseInt(lastRow[2]);
        model_drop_down_index = parseInt(lastRow[4]);
        related_colors_drop_down_index = parseInt(lastRow[6]);
        color_family_drop_down_index = parseInt(lastRow[8]);
        solid_effect_drop_down_index = parseInt(lastRow[10]);
        
        // starting_from_csv_skip_loop = true;
    }
    else {
        const all_completed = readLastRowFromCsv(all_completed_filter_csv);
        if (all_completed) {
            make_drop_down_index = parseInt(all_completed[0]);
            year_drop_down_index = parseInt(all_completed[2]);
            model_drop_down_index = parseInt(all_completed[4]);
            related_colors_drop_down_index = parseInt(all_completed[6]);
            color_family_drop_down_index = parseInt(all_completed[8]);
            solid_effect_drop_down_index = parseInt(all_completed[10]);
            // starting_from_csv_skip_loop = true;
        }
    }
    filters_obj = {
        description: null,
        year: year_drop_down_index,
        make: make_drop_down_index,
        model: model_drop_down_index,
        plastic_parts: related_colors_drop_down_index,
        groupdesc: color_family_drop_down_index,
        effect: solid_effect_drop_down_index,
    };
    await setSearchFilters(page, null);

    if(lastRow||all_completed){
        let filter_completed = false;
        if (solid_effect_drop_down_index >= solid_effect_drop_down.length -1) {
            solid_effect_drop_down_index = 0;
            color_family_drop_down_index++;
            filter_completed = true;
        }
        else{
            solid_effect_drop_down_index++;
        }
        
        // If we're at the end of color_family_drop_down, reset and increment related_colors_drop_down
        if (color_family_drop_down_index >= color_family_drop_down.length -1 && filter_completed) {
            color_family_drop_down_index = 0;
            related_colors_drop_down_index++;
        }
        
        // If we're at the end of related_colors_drop_down, reset and increment model_drop_down
        if (related_colors_drop_down_index >= related_colors_drop_down.length -1 && filter_completed) {
            related_colors_drop_down_index = 0;
            model_drop_down_index++;
        }
        console.log("model_drop_down:",_models_drop_down);
        if (model_drop_down_index >= _models_drop_down.length -1 && filter_completed) {
            model_drop_down_index = 0;
            year_drop_down_index++;
        }
        
        // If we're at the end of year_drop_down, reset and increment make_drop_down
        if (year_drop_down_index >= year_drop_down.length -1 && filter_completed) {
            year_drop_down_index = 0;
            make_drop_down_index++;
        }
    }

    let shouldStop = false; // Flag to control loop termination
    let total_count = 0;
    const retryOptions = {
        maxRetries: 15,           // 30 retries
        initialDelay: 1000,       // Starting with 1 second delay
        maxDelay: 10 * 60 * 1000  // Up to 10 minutes total wait time
    };
                            console.log("before combination in loop :");
                             console.log("Processing combination in loop :");
                             console.log("make:", make_drop_down_index, "/", make_drop_down.length);
                             console.log("year:", year_drop_down_index, "/", year_drop_down.length);
                             console.log("model:", model_drop_down_index, "/", _models_drop_down.length);
                             console.log("related_colors:", related_colors_drop_down_index, "/", related_colors_drop_down.length);
                             console.log("color_family:", color_family_drop_down_index, "/", color_family_drop_down.length);
                             console.log("solid_effect:", solid_effect_drop_down_index, "/", solid_effect_drop_down.length);
                    
    for (; make_drop_down_index < make_drop_down.length; make_drop_down_index++) {
        for (; year_drop_down_index < year_drop_down.length; year_drop_down_index++) {
            for (; model_drop_down_index < _models_drop_down.length; model_drop_down_index++) {
                for (; related_colors_drop_down_index < related_colors_drop_down.length; related_colors_drop_down_index++) {
                    for (; color_family_drop_down_index < color_family_drop_down.length; color_family_drop_down_index++) {
                        for (; solid_effect_drop_down_index < solid_effect_drop_down.length; solid_effect_drop_down_index++) {
                            // if (starting_from_csv_skip_loop) {
                            //     starting_from_csv_skip_loop = false;
                            //     continue;
                            // }
                             console.log("Processing combination in loop :");
                             console.log("make:", make_drop_down_index, "/", make_drop_down.length);
                             console.log("year:", year_drop_down_index, "/", year_drop_down.length);
                             console.log("model:", model_drop_down_index, "/", model_drop_down.length);
                             console.log("related_colors:", related_colors_drop_down_index, "/", related_colors_drop_down.length);
                             console.log("color_family:", color_family_drop_down_index, "/", color_family_drop_down.length);
                             console.log("solid_effect:", solid_effect_drop_down_index, "/", solid_effect_drop_down.length);
                    
                            filters_obj = {
                                description: null,
                                year: year_drop_down_index,
                                make: make_drop_down_index,
                                model: model_drop_down_index,
                                plastic_parts: related_colors_drop_down_index,
                                groupdesc: color_family_drop_down_index,
                                effect: solid_effect_drop_down_index,
                            };

                            try {
                                // await scrapDataFromPages();
                                await retryWithBackoff(
                                    async () => {
                                        await scrapDataFromPages();
                                        return true;
                                    },
                                    retryOptions.maxRetries,
                                    retryOptions.initialDelay
                                );
                                const row = [
                                    make_drop_down_index, make_drop_down[make_drop_down_index],
                                    year_drop_down_index, year_drop_down[year_drop_down_index],
                                    model_drop_down_index, _models_drop_down[model_drop_down_index],
                                    related_colors_drop_down_index, related_colors_drop_down[related_colors_drop_down_index],
                                    color_family_drop_down_index, color_family_drop_down[color_family_drop_down_index],
                                    solid_effect_drop_down_index, solid_effect_drop_down[solid_effect_drop_down_index]
                                ].join(',') + '\n';
                                writeCurrentRowToCsv(row);
                                appendCurrentRowToCsv(row);

                                total_count++;
                            } catch (error) {
                                console.error(`Final attempt failed after ${retryOptions.maxRetries} retries:`, error);
                                res.write(`data: [ERROR] ${error.message}\n\n`);
                                // Continue to next iteration instead of breaking completely
                                continue;
                            }
                        }
                        solid_effect_drop_down_index = 0;
                        if (shouldStop) break; // Exit the color_family_drop_down loop
                    }
                    color_family_drop_down_index = 0;
                    if (shouldStop) break; // Exit the related_colors_drop_down loop
                }
                if (shouldStop) break; // Exit the year_drop_down loop
                related_colors_drop_down_index = 0;
            }
            if (shouldStop) break; // Exit the make_drop_down loop
            model_drop_down_index = 0;//0
        }
        if (shouldStop) break; // Exit the make_drop_down loop
        year_drop_down_index = 1;//0
    }

    return;

}


async function recoverPage() {
    try {
        await page.reload();
        //   await page.waitForSelector('#plastic_parts', { timeout: 60000 });
        await new_page.reload();
        //   await new_page.waitForSelector('#plastic_parts', { timeout: 60000 });
        let randomWaitTime = getRandomNumber(5500, 7500);
        await page.waitForTimeout(randomWaitTime);
        return true;
    } catch (error) {
        console.error('Page recovery failed:', error);
        return false;
    }
}
async function retryWithBackoff(operation, maxRetries = 15, initialDelay = 1000) {
    let lastError;
    for (let i = 0; i < maxRetries; i++) {
        try {
            return await operation();
        } catch (error) {
            lastError = error;
            if (i === maxRetries - 1) break;

            // const delay = initialDelay * Math.pow(2, i);
            const delay = initialDelay * i;
            console.log(`Attempt ${i + 1} failed. Retrying in ${delay}ms...`);

            // Try to recover the page every 3rd attempt
            if (i % 3 === 0) {
                await recoverPage();
            }

            await new Promise(resolve => setTimeout(resolve, delay));
        }
    }
    throw lastError;
}

async function has_digital_formula(formula_page, selector) {
    let retryCount = 0;
    let MAX_RETRIES = 5;
    let ERROR_MESSAGE = 'We could not find any formulas. Try to modify your search.';
    while (retryCount < MAX_RETRIES) {
        try {
            let randomWaitTime = getRandomNumber(1500, 2500);
            await formula_page.waitForTimeout(randomWaitTime);
            let errorAlert = await formula_page.$('.alert.alert-danger');
            if (errorAlert) {
                let errorText = await formula_page.evaluate(el => el.textContent.trim(), errorAlert);
                if (errorText.includes(ERROR_MESSAGE)) {
                    console.log('Error message detected - no formulas found');
                    return false;
                }
            }

            await Promise.race([
                formula_page.waitForSelector(selector, { timeout: 10000 }),
                new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), 10000))
            ]);
            return true; // Return immediately if found

        } catch (error) {
            retryCount++;
            console.log(`Retry ${retryCount}/${MAX_RETRIES} for selector "${selector}"...`);
            await loginPage(formula_page);
            // Optional: Add delay between retries
            if (retryCount < MAX_RETRIES) {
                await new Promise(resolve => setTimeout(resolve, 1000 * retryCount));
            }
        }
    }

    console.log(`Selector "${selector}" not found in page after ${MAX_RETRIES} attempts`);
    return false;
}

async function scrapDataFromPages() {
    let data_arr = [];
    let descriptionStack = [];
    let hasNextPage = true;
    currentRecursionDepth = 0;
    visitedMultitones.clear();
    await setSearchFilters(page);
    // return;
    while (hasNextPage) {
        let containers_details = null;
        try {
            // Wait for the selector with a timeout of 10 seconds
            if (!(await has_digital_formula(page, '#digital_formula'))) {
                hasNextPage = false;
                break;
            }

            containers_details = await page.$$eval('#digital_formula > .root', (elements, filters,_models_drop_down) => {
                return elements.map(el => {
                    return {
                        familyId: el.getAttribute('family_id'),
                        sid: el.getAttribute('sid'),
                        make: el.getAttribute('make'),
                        model: (filters?.model)//&& _models_drop_down[filters.model]
                            ? _models_drop_down[filters.model]
                            : "",
                        description: el.getAttribute('desc'),
                        url: el.getAttribute('url'),
                        content: el.innerText.trim()
                    };
                });
            }, filters_obj);

            console.log('Found containers:', containers_details.length);

            for (let i = 0; i < containers_details.length; i++) {
                console.log('Processing container', i);
                const container = containers_details[i];

                // Get fresh handles for current container
                const containerHandles = await page.$$('#digital_formula > .root');
                if (i >= containerHandles.length) {
                    console.error('Container handle index out of bounds');
                    continue;
                }

                const currentHandle = containerHandles[i];
                let hasMultitoneAccess = await currentHandle.$('.formula-multitone-access');
                let extracted_data = {};

                if (hasMultitoneAccess) {
                    if (visitedMultitones.size < MAX_VISITED_ENTRIES
                        && !visitedMultitones.has(container.description)) {
                        console.log('Multitone found in container:', container.description);
                        descriptionStack.push({
                            description: container.description,
                            depth: currentRecursionDepth + 1
                        });
                        visitedMultitones.add(container.description);
                        console.log('descriptionStack:', descriptionStack);
                    }

                } else {
                    // continue;
                    const buttons = await page.$$('#digital_formula > .root button[data-original-title="Color Information"]');
                    extracted_data = await scrapDataFromList(
                        page,
                        container,
                        buttons,
                        i,
                        data_arr
                    );
                    await saveToExcel([extracted_data], 'paint/sheets/paint.csv');
                }
                console.log('Saved container data:', container.description);
            }
            while (descriptionStack.length > 0) {
                const { description, depth } = descriptionStack.pop();
                currentRecursionDepth = depth;

                if (currentRecursionDepth > MAX_RECURSION_DEPTH) {
                    console.warn('Maximum recursion depth reached, skipping:', description);
                    continue;
                }

                await setSearchFilters(multitone_page, description);

                let hasNextMultiPage = true;
                while (hasNextMultiPage) {
                    // Wait for containers to load in multitone page
                    if (!(await has_digital_formula(multitone_page, '#digital_formula'))) {
                        hasNextMultiPage = false;
                        break;
                    }

                    // Get buttons and containers from multitone page
                    const buttons = await multitone_page.$$('#digital_formula > .root button[data-original-title="Color Information"]');
                    const multitoneContainers = await multitone_page.$$eval('#digital_formula > .root', (elements, filters,_models_drop_down) => {
                        return elements.map(el => {
                            const isMultitone = el.querySelector('.formula-multitone-access') !== null;
                            return {
                                familyId: el.getAttribute('family_id'),
                                sid: el.getAttribute('sid'),
                                make: el.getAttribute('make'),
                                model: (filters?.model)//&& _models_drop_down[filters.model]
                                    ? _models_drop_down[filters.model]
                                    : "",
                                description: el.getAttribute('desc'),
                                url: el.getAttribute('url'),
                                content: el.innerText.trim(),
                                isMultitone: isMultitone
                            };
                        });
                    }, filters_obj);

                    // Process each container in multitone page
                    for (let j = 0; j < multitoneContainers.length; j++) {
                        const mtContainer = multitoneContainers[j];
                        let currentPageNumber = await getCurrentPageNumber(page); // Implement this function

                        // Save to text file
                        const stateData = `Current Page: ${currentPageNumber}\nFilters: ${JSON.stringify(filters_obj)}\n`;
                        const multitoneFile = 'multitone_filter.txt';
                        if (mtContainer.isMultitone) {
                            descriptionStack.push({
                                description: mtContainer.description,
                                depth: currentRecursionDepth + 1
                            });
                            visitedMultitones.add(mtContainer.description);
                            console.log('found one more multitone');
                            console.log(multitoneFile, stateData);

                        } else {
                            console.log('found direct data in  multitone');
                            // continue;
                            extracted_data = await scrapDataFromList(
                                multitone_page,
                                mtContainer,
                                buttons,
                                j,
                                data_arr
                            );
                            // await fs.promises.writeFile(multitoneFile, stateData);

                            await saveToExcel([extracted_data], 'paint/sheets/paint.csv');
                        }
                    }

                    hasNextMultiPage = await goToNextPage(multitone_page);

                }
            }

            hasNextPage = await goToNextPage(page);
        } catch (error) {
            if (error.message === 'Timeout') {
                console.log('Timeout: #digital_formula not found within 10 seconds');
                break;
            } else {
                console.error('Error in setSearchFilters:', error);
                break;
            }
        }
    }
}


async function scrapDataFromList(listpage, container, buttons, i, data_arr) {
    let combinedData = {};
    let detailColorUrl = '';
    try {
        buttons = await listpage.$$('#digital_formula > .root button[data-original-title="Color Information"]');

        if (buttons[i]) {
            console.log(`Processing container ${i}`);
            await buttons[i].scrollIntoViewIfNeeded();
            const onclickValue = await buttons[i].evaluate(button => button.getAttribute('onclick'));

            const urlAndIdMatch = onclickValue.match(/formulaInfo\(event,'([^']+)','([^']+)'\)/);
            if (urlAndIdMatch && urlAndIdMatch[1] && urlAndIdMatch[2]) {
                const url = urlAndIdMatch[1];
                const id = urlAndIdMatch[2];
                let scrap_details = await scrapFormaulaDetailsData(container.sid, container.familyId);
                for (const scrap_detail of scrap_details) {
                    combinedData = { ...container, ...scrap_detail };
                    data_arr.push(combinedData);
                }
                infoColorUrl = `https://generalpaint.info/v2/search/formula-info?id=${id}`;
                detailColorUrl = `https://generalpaint.info/v2/search/family?id=${container.familyId}&sid=${container.sid}`;
                console.log('detailColorUrl:', detailColorUrl);

                // await scrapColorInfoData(id);
                // infoColorUrl = 'https://generalpaint.info/v2/search/formula-info?id=107573';
                // detailColorUrl = 'https://generalpaint.info/v2/search/family?id=67746&sid=67d00e248ae305.41320823';
            } else {
                console.error('Failed to extract URL and ID from onclick value');
            }
        }
    }
    catch (error) {
        console.error('Error scrapDataFromList:', error);
        console.error('url :', detailColorUrl);
    }
    finally {
        return combinedData;
    }

}

async function saveToExcel(dataArray, fileName = 'paint/sheets/paint.csv') {
    const makeDropdown = await get_make_drop_down();
    const filePath = 'paint/sheets/';
    fs.mkdirSync(path.join('paint', 'sheets'), { recursive: true });
    fileName = path.join(filePath, `${makeDropdown[filters_obj.make]}.csv`);
    console.log("excel 4");

    const cleanedDataArray = dataArray.map(row => {
        const cleanedRow = {};
        for (const key in row) {
            if (row.hasOwnProperty(key)) {
                const value = row[key];
                cleanedRow[key] = (value != null ? String(value) : '') // handles null and undefined
                    .replace(/\n/g, ' ')
                    .replace(/<br>/g, ' ')
                    .replace(/\t/g, ' ')
                    .replace(/\s+/g, ' ')
                    .trim();
            }
        }
        return cleanedRow;
    });
    const csvData = cleanedDataArray.map(row => {
        return Object.values(row).join(',');
    }).join('\n');
    console.log('apend file row data', csvData);
    if (fs.existsSync(fileName)) {
        fs.appendFileSync(fileName, `\n${csvData}`);
    } else {
        const header = Object.keys(cleanedDataArray[0]).join(',');
        fs.writeFileSync(fileName, `${header}\n${csvData}`);
    }
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
        console.log(`step 1 `);
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