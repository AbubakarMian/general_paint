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
const xlsx = require('xlsx');
const { createCanvas } = require('canvas');
let current_filter_csv = 'paint/current_filter_csv.csv';
let all_completed_filter_csv = 'paint/all_completed_filter_csv.csv';


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
    // await new_page.goto(load_url);
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
            let panelNoElement = Array.from(tr.querySelectorAll('.formula-h1'))
                .find(el => el.innerText.includes('Panel no.'))
                ?.nextElementSibling;
            let panelNo = panelNoElement ? panelNoElement.innerText.trim() : '';

            if (!panelNo) {

            }
            console.log('panel no ', panelNo);
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

async function downloadSearchFamilyCanvasImage(sid, id, canvas_page) {
    console.log('creating img');
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
        let random_number = getRandomNumber(10000,99999);
        let uniq_name = getUniqueName(`${random_number}_${id}_${sid}_${index}.png`);
        const base64Data = image.replace(/^data:image\/png;base64,/, '');
        let color_path = await getColorPath();
        
        let imagePath = path.join(color_path,uniq_name );
        // let imagePath = path.join('paint/colors', `${random_number}_${id}_${sid}_${index}.png`);
        images_arr.push(imagePath);
        fs.writeFileSync(imagePath, base64Data, 'base64', (err) => {
            if (err) console.error(`Error saving image ${index}:`, err);
            else console.log(`Image ${index} saved successfully!`);
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
    const relatedColorsDropdown = await get_related_colors_drop_down();
    const colorFamilyDropdown = await get_color_family_drop_down();
    const solidEffectDropdown = await get_solid_effect_drop_down();
    
    const color_path = path.join(
        'paint',
        'colors',
        makeDropdown[filters_obj.make_dropdown],
        yearDropdown[filters_obj.year],
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

    console.log('Extracted Data:', data);
    return data;
}

async function setSearchFilters(selected_page, description = null) {
    filters_obj.description = description;
    let filters = filters_obj;

    let randomWaitTime = getRandomNumber(1000, 1500);
    // await selected_page.waitForTimeout(randomWaitTime);
    // description: null,
    // make_dropdown: make_drop_down_index,
    // year:year_drop_down_index,
    // plastic_parts:related_colors_drop_down_index,
    // groupdesc:color_family_drop_down_index,
    // effect:solid_effect_drop_down_index,

    // console.log('my filters set : ', filters);

    await selected_page.waitForSelector('#make_dropdown');
    if (filters.make_dropdown !== null) {
        await selected_page.selectOption('#make_dropdown', { index: filters.make_dropdown });
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
        if (filters.plastic_parts !== 0) {
            await selected_page.selectOption('#plastic_parts', { index: filters.plastic_parts });
        }
        // await selected_page.selectOption('#plastic_parts', { index: filters.plastic_parts });
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


    let submitButtonSelector = '.btn.btn-success.btn-lg.mr-3';
    await Promise.all([
        selected_page.click(submitButtonSelector),
    ]);

    await selected_page.waitForTimeout(randomWaitTime);
}
const goToNextPage = async (nextpage) => {
    try {
        console.log('goToNextPage 1');
        // Find the active page
        const activePageItem = await nextpage.$('.pagination li.active');
        if (!activePageItem) {
            console.log('No active page found.');
            return false;
        }

        // Find the next page item
        const nextPageItem = await activePageItem.evaluateHandle((el) => el.nextElementSibling);
        if (!nextPageItem || !(await nextPageItem.asElement())) {
            console.log('No next page found.');
            return false;
        }

        // Click the next page link
        const nextPageLink = await nextPageItem.$('a.page-link');
        if (!nextPageLink) {
            console.log('No next page link found.');
            return false;
        }

        await Promise.all([
            nextPageLink.click(),
            // nextpage.waitForNavigation({ waitUntil: 'networkidle0' })
        ]);

        console.log('goToNextPage 3');
        await nextpage.waitForSelector('#digital_formula');
        console.log('goToNextPage 4');
        await nextpage.waitForTimeout(5000);
        console.log('goToNextPage 5');


    } catch (error) {
        console.error('Error in goToNextPage:', error);
        throw error;
    }

    return true;
};

async function get_make_drop_down() {
    return [//248
        "Manufacturer", "ACURA", "AFNOR", "AIWAYS", "AIXAM", "ALFA ROMEO", "ALPINE", "AMERICAN MOTORS", "APRILIA MOTO", "ARO", "ASIA", "ASTON MARTIN", "AUDI", "AVATR", "BAIC", "BEDFORD", "BELLIER", "BENELLI MOTO", "BENTLEY", "BERKLEY", "BERLIET", "BERTONE", "BMW", "BMW MOTO", "BORGWARD", "BRILLIANCE", "BS2660", "BS381C", "BS4800", "BS5252", "BUERSTNER", "BUGATTI", "BYD AUTO", "CASALINI", "CATERHAM CARS", "CHANGAN", "CHATENET", "CHERY", "CHEVROLET EUR_", "CHRYSLER", "CITROEN", "CLUB CAR", "COMM_VEH_USA", "DACIA", "DAEWOO", "DAEWOO IRAN", "DAF TRUCKS", "DAIHATSU", "DANEMARK STAND", "DATSUN", "DENZA", "DERBI MOTO", "DHL EXPRESS", "DKW", "DONGFENG AUTO", "DR AUTOMOBILES", "DR MOTOR COMPANY", "DUCATI MOTO", "EDSEL", "ERF", "FACEL VEGA", "FAW HONGQI", "FCS", "FERRARI", "FIAT_LANCIA", "FINLANDE STAN", "FISKER", "FLEET", "FLEET GERMANY", "FLEET_AUSTRALIA", "FLEET_FRANCE", "FLEET_SAUDI AR", "FLEET_SPAIN", "FLEET_UK", "FORD EUROPE", "FORD_S_AFRICA", "FORD_USA", "FORD_AUSTRALIA", "FOTON", "FREIGHTLINER", "FSO", "GAC MOTOR", "GAT", "GAZ", "GEELY", "GENERAL MOTORS", "GEO", "GILERA MOTORCYCLES", "GREATWALL AUTO", "GROOVE", "HAFEI", "HAIMA", "HANOMAG", "HARLEY_DAVIDSON", "HAVAL", "HIPHI", "HKS", "HOLDEN", "HONDA", "HONDA MOTO", "HOZON AUTO", "HUMMER", "HYCAN", "HYUNDAI", "IM MOTORS", "INEOS AUTOMOTIVE", "INFINITI", "INNOCENTI", "ISUZU", "IVECO", "JAC MOTORS", "JAGUAR", "JENSEN", "JETOUR", "KARMA AUTO", "KAWASAKI MOTO", "KIA", "KTM MOTO", "KYMCO MOTO", "LADA", "LAMBORGHINI", "LAMBRETTA", "LAND ROVER", "LATAMMO MOTO", "LDV", "LEADING IDEAL", "LEAP MOTOR", "LEVDEO", "LEXUS", "LEYLAND", "LI AUTO", "LIFAN", "LIGIER", "LML", "LONDON ELECTRIC VEHICLE C", "LONDON TAXI", "LOTUS", "LUCID MOTORS", "LUXGEN", "LYNK AND CO", "MAGIRUS", "MAHINDRA", "MALAGUTI MOTO", "MAN", "MARUTI", "MASERATI", "MATRA", "MAZDA", "MCLAREN", "MERCEDES", "MERCEDES TRUCKS", "MG", "MICROCAR", "MIDDLEBRIDGE", "MINI", "MITSUBISHI", "MITSUBISHI TRUCKS", "MORGAN", "MOSKVITCH", "MOTO GUZZI MOTORCYCLES", "MOTORCYCLES", "NAVISTAR", "NCS", "NIO", "NISSAN", "NISSAN S_AFRICA", "NORMAS UNE", "ODA", "OPEL S_AFRICA", "OPEL_VAUXHALL", "OTHER", "PANHARD", "PANTONE", "PERODUA", "PEUGEOT", "PEUGEOT MOTO", "PIAGGIO MOTO", "POLESTAR", "POLESTONES", "PORSCHE", "PRIMER", "PROTON", "QOROS", "RAL", "RAL DESIGN", "RELIANT", "RENAULT", "RENAULT TRUCKS", "RIVIAN", "ROEWE", "ROLLS ROYCE", "ROOTES", "ROVER", "ROX", "SAAB", "SAIC_GM", "SAIPA", "SAMSUNG", "SANTANA", "SCANIA TRUCKS", "SEAT", "SERES", "SETRA", "SINOTRUK", "SKODA", "SKYWELL", "SMART", "SOUEAST", "SPECTRUM", "SSANGYONG", "STUDEBAKER", "SUBARU", "SUZUKI", "SUZUKI MOTO", "SWM MOTORS", "TALBOT", "TATA", "TATRA TRUCKS", "TESLA MOTORS", "TOYOTA", "TOYOTA S_AFRICA", "TOYOTA TRUCKS", "TRABANT", "TRIUMPH", "TRIUMPH MOTO", "TVR", "UAZ", "UMM", "VESPA", "VOLGA", "VOLKSWAGEN", "VOLVO", "VOLVO TRUCKS", "VORTEX", "VOYAH", "VSLF_USVC", "VW BRAZIL", "VW SHANGHAI", "WARTBURG", "WEY", "WM MOTOR", "WULING", "XPENG MOTORS", "YAMAHA MOTO", "YUGO", "ZAZ", "ZEEKR", "ZOTYE"
       // "Manufacturer", "ACURA", "AFNOR" //"AIWAYS", "AIXAM", "ALFA ROMEO", "ALPINE", "AMERICAN MOTORS", "APRILIA MOTO", "ARO", "ASIA", "ASTON MARTIN", "AUDI", "AVATR", "BAIC", "BEDFORD", "BELLIER", "BENELLI MOTO", "BENTLEY", "BERKLEY", "BERLIET", "BERTONE", "BMW", "BMW MOTO", "BORGWARD", "BRILLIANCE", "BS2660", "BS381C", "BS4800", "BS5252", "BUERSTNER", "BUGATTI", "BYD AUTO", "CASALINI", "CATERHAM CARS", "CHANGAN", "CHATENET", "CHERY", "CHEVROLET EUR.", "CHRYSLER", "CITROEN", "CLUB CAR", "COMM.VEH.USA", "DACIA", "DAEWOO", "DAEWOO IRAN", "DAF TRUCKS", "DAIHATSU", "DANEMARK STAND", "DATSUN", "DENZA", "DERBI MOTO", "DHL EXPRESS", "DKW", "DONGFENG AUTO", "DR AUTOMOBILES", "DR MOTOR COMPANY", "DUCATI MOTO", "EDSEL", "ERF", "FACEL VEGA", "FAW HONGQI", "FCS", "FERRARI", "FIAT/LANCIA", "FINLANDE STAN", "FISKER", "FLEET", "FLEET GERMANY", "FLEET-AUSTRALIA", "FLEET-FRANCE", "FLEET-SAUDI AR", "FLEET-SPAIN", "FLEET-UK", "FORD EUROPE", "FORD-S.AFRICA", "FORD-USA", "FORD_AUSTRALIA", "FOTON", "FREIGHTLINER", "FSO", "GAC MOTOR", "GAT", "GAZ", "GEELY", "GENERAL MOTORS", "GEO", "GILERA MOTORCYCLES", "GREATWALL AUTO", "GROOVE", "HAFEI", "HAIMA", "HANOMAG", "HARLEY-DAVIDSON", "HAVAL", "HIPHI", "HKS", "HOLDEN", "HONDA", "HONDA MOTO", "HOZON AUTO", "HUMMER", "HYCAN", "HYUNDAI", "IM MOTORS", "INEOS AUTOMOTIVE", "INFINITI", "INNOCENTI", "ISUZU", "IVECO", "JAC MOTORS", "JAGUAR", "JENSEN", "JETOUR", "KARMA AUTO", "KAWASAKI MOTO", "KIA", "KTM MOTO", "KYMCO MOTO", "LADA", "LAMBORGHINI", "LAMBRETTA", "LAND ROVER", "LATAMMO MOTO", "LDV", "LEADING IDEAL", "LEAP MOTOR", "LEVDEO", "LEXUS", "LEYLAND", "LI AUTO", "LIFAN", "LIGIER", "LML", "LONDON ELECTRIC VEHICLE C", "LONDON TAXI", "LOTUS", "LUCID MOTORS", "LUXGEN", "LYNK AND CO", "MAGIRUS", "MAHINDRA", "MALAGUTI MOTO", "MAN", "MARUTI", "MASERATI", "MATRA", "MAZDA", "MCLAREN", "MERCEDES", "MERCEDES TRUCKS", "MG", "MICROCAR", "MIDDLEBRIDGE", "MINI", "MITSUBISHI", "MITSUBISHI TRUCKS", "MORGAN", "MOSKVITCH", "MOTO GUZZI MOTORCYCLES", "MOTORCYCLES", "NAVISTAR", "NCS", "NIO", "NISSAN", "NISSAN S.AFRICA", "NORMAS UNE", "ODA", "OPEL S.AFRICA", "OPEL/VAUXHALL", "OTHER", "PANHARD", "PANTONE", "PERODUA", "PEUGEOT", "PEUGEOT MOTO", "PIAGGIO MOTO", "POLESTAR", "POLESTONES", "PORSCHE", "PRIMER", "PROTON", "QOROS", "RAL", "RAL DESIGN", "RELIANT", "RENAULT", "RENAULT TRUCKS", "RIVIAN", "ROEWE", "ROLLS ROYCE", "ROOTES", "ROVER", "ROX", "SAAB", "SAIC-GM", "SAIPA", "SAMSUNG", "SANTANA", "SCANIA TRUCKS", "SEAT", "SERES", "SETRA", "SINOTRUK", "SKODA", "SKYWELL", "SMART", "SOUEAST", "SPECTRUM", "SSANGYONG", "STUDEBAKER", "SUBARU", "SUZUKI", "SUZUKI MOTO", "SWM MOTORS", "TALBOT", "TATA", "TATRA TRUCKS", "TESLA MOTORS", "TOYOTA", "TOYOTA S.AFRICA", "TOYOTA TRUCKS", "TRABANT", "TRIUMPH", "TRIUMPH MOTO", "TVR", "UAZ", "UMM", "VESPA", "VOLGA", "VOLKSWAGEN", "VOLVO", "VOLVO TRUCKS", "VORTEX", "VOYAH", "VSLF/USVC", "VW BRAZIL", "VW SHANGHAI", "WARTBURG", "WEY", "WM MOTOR", "WULING", "XPENG MOTORS", "YAMAHA MOTO", "YUGO", "ZAZ", "ZEEKR", "ZOTYE"
    ];
}

async function get_year_drop_down() {
    return [ // 109
         "Year", "2027", "2026", "2025", "2024", "2023", "2022", "2021", "2020", "2019", "2018", "2017", "2016", "2015", "2014", "2013", "2012", "2011", "2010", "2009", "2008", "2007", "2006", "2005", "2004", "2003", "2002", "2001", "2000", "1999", "1998", "1997", "1996", "1995", "1994", "1993", "1992", "1991", "1990", "1989", "1988", "1987", "1986", "1985", "1984", "1983", "1982", "1981", "1980", "1979", "1978", "1977", "1976", "1975", "1974", "1973", "1972", "1971", "1970", "1969", "1968", "1967", "1966", "1965", "1964", "1963", "1962", "1961", "1960", "1959", "1958", "1957", "1956", "1955", "1954", "1953", "1952", "1951", "1950", "1949", "1948", "1947", "1946", "1945", "1944", "1943", "1942", "1941", "1940", "1939", "1938", "1937", "1936", "1935", "1934", "1933", "1932", "1931", "1930", "1929", "1928", "1927", "1926", "1925", "1924", "1923", "1922", "1921", "1920"
        // "Year", "2027", "2026",//, "2025" "2024", "2023", "2022", "2021", "2020", "2019", "2018", "2017", "2016", "2015", "2014", "2013", "2012", "2011", "2010", "2009", "2008", "2007", "2006", "2005", "2004", "2003", "2002", "2001", "2000", "1999", "1998", "1997", "1996", "1995", "1994", "1993", "1992", "1991", "1990", "1989", "1988", "1987", "1986", "1985", "1984", "1983", "1982", "1981", "1980", "1979", "1978", "1977", "1976", "1975", "1974", "1973", "1972", "1971", "1970", "1969", "1968", "1967", "1966", "1965", "1964", "1963", "1962", "1961", "1960", "1959", "1958", "1957", "1956", "1955", "1954", "1953", "1952", "1951", "1950", "1949", "1948", "1947", "1946", "1945", "1944", "1943", "1942", "1941", "1940", "1939", "1938", "1937", "1936", "1935", "1934", "1933", "1932", "1931", "1930", "1929", "1928", "1927", "1926", "1925", "1924", "1923", "1922", "1921", "1920"
    ];
}
async function get_related_colors_drop_down() {
    return [//14
         "Related Colors", "Bumper", "Chassis", "Door Window", "Interior", "Multitone", "Roof", "Stripe", "Underhood", "Wheel", "Door Handle", "Grill Radiator", "Mirror", "Trim"
        //"Related Colors", "Bumper", "Chassis"// "Door Window", "Interior", "Multitone", "Roof", "Stripe", "Underhood", "Wheel", "Door Handle", "Grill Radiator", "Mirror", "Trim"
    ];
}
async function get_color_family_drop_down() {
    return [//13
        // "Color Family", "BEIGE", "BLACK", "BLANK", "BLUE", "BROWN", "GREEN", "GREY", "ORANGE", "RED", "VIOLET", "WHITE", "YELLOW"
        "Color Family", "BEIGE", "BLACK", //"BLANK", "BLUE", "BROWN", "GREEN", "GREY", "ORANGE", "RED", "VIOLET", "WHITE", "YELLOW"
    ];
}
async function get_solid_effect_drop_down() {
    return [//3
        "Solid and Effect", "Solid", "Effect"
    ];
}
const writeCurrentRowToCsv = (row) => {
    const csvFilePath = current_filter_csv;
    const header = 'Make Index,Make,Year Index,Year,Related Colors Index,Related Colors,Color Family Index,Color Family,Solid Effect Index,Solid Effect\n';
    const csvContent = header + row; // Overwrite the file with the header and current row
    fs.writeFileSync(csvFilePath, csvContent);
    // console.log(`Current Row: ${row.trim()}`);
};


const appendCurrentRowToCsv = (row) => {
    const csvFilePath = all_completed_filter_csv;
    const fileExists = fs.existsSync(csvFilePath);
    if (!fileExists) {
        const header = 'Make Index,Make,Year Index,Year,Related Colors Index,Related Colors,Color Family Index,Color Family,Solid Effect Index,Solid Effect\n';
        fs.writeFileSync(csvFilePath, header); // Write the header
    }
    fs.appendFileSync(csvFilePath, row);
    console.log(`Current Row: ${row.trim()}`);
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
    console.log("load from page ");

    let make_drop_down = await get_make_drop_down();
    let year_drop_down = await get_year_drop_down();
    let related_colors_drop_down = await get_related_colors_drop_down();
    let color_family_drop_down = await get_color_family_drop_down();
    let solid_effect_drop_down = await get_solid_effect_drop_down();
    const lastRow = readLastRowFromCsv(current_filter_csv);
    let make_drop_down_index = 0;
    let year_drop_down_index = 0;
    let related_colors_drop_down_index = 0;
    let color_family_drop_down_index = 0;
    let solid_effect_drop_down_index = 0;
    let starting_from_csv_skip_loop = false;
    if (lastRow) {
        make_drop_down_index = parseInt(lastRow[0]);
        year_drop_down_index = parseInt(lastRow[2]);
        related_colors_drop_down_index = parseInt(lastRow[4]);
        color_family_drop_down_index = parseInt(lastRow[6]);
        solid_effect_drop_down_index = parseInt(lastRow[8]);
        starting_from_csv_skip_loop = true;
    }
    else {
        const all_completed = readLastRowFromCsv(all_completed_filter_csv);
        if (all_completed) {
            make_drop_down_index = parseInt(all_completed[0]);
            year_drop_down_index = parseInt(all_completed[2]);
            related_colors_drop_down_index = parseInt(all_completed[4]);
            color_family_drop_down_index = parseInt(all_completed[6]);
            solid_effect_drop_down_index = parseInt(all_completed[8]);
            starting_from_csv_skip_loop = true;
        }
    }

    let shouldStop = false; // Flag to control loop termination
    let total_count = 0;

    for (; make_drop_down_index < make_drop_down.length; make_drop_down_index++) {
        for (; year_drop_down_index < year_drop_down.length; year_drop_down_index++) {
            // console.log("starting  year_drop_down_index");

            for (; related_colors_drop_down_index < related_colors_drop_down.length; related_colors_drop_down_index++) {
                // console.log("starting  related_colors_drop_down_index");

                for (; color_family_drop_down_index < color_family_drop_down.length; color_family_drop_down_index++) {
                    // console.log("starting  solid_effect_drop_down_index");

                    for (; solid_effect_drop_down_index < solid_effect_drop_down.length; solid_effect_drop_down_index++) {
                        // console.log("in  solid_effect_drop_down_index");

                        if (starting_from_csv_skip_loop) {
                            console.log("skip loop");
                            starting_from_csv_skip_loop = false;
                            continue;
                        }
                        filters_obj = {
                            description: null,
                            make_dropdown: make_drop_down_index,
                            year: year_drop_down_index,
                            plastic_parts: related_colors_drop_down_index,
                            groupdesc: color_family_drop_down_index,
                            effect: solid_effect_drop_down_index,
                        };
                        await scrapDataFromPages();
                        const row = [
                            make_drop_down_index, make_drop_down[make_drop_down_index],
                            year_drop_down_index, year_drop_down[year_drop_down_index],
                            related_colors_drop_down_index, related_colors_drop_down[related_colors_drop_down_index],
                            color_family_drop_down_index, color_family_drop_down[color_family_drop_down_index],
                            solid_effect_drop_down_index, solid_effect_drop_down[solid_effect_drop_down_index]
                        ].join(',') + '\n';
                        writeCurrentRowToCsv(row);
                        appendCurrentRowToCsv(row);
                        // console.log("solid_effect_drop_down index :" + solid_effect_drop_down_index, solid_effect_drop_down_index);

                        // if (total_count > 100) {
                        //     shouldStop = true; // Set the flag to true
                        //     break; // Exit the innermost loop
                        // }
                        // console.log("starting  break");

                        // break;
                        // console.log("after  break");

                        total_count++;
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
        year_drop_down_index = 0;
    }
    // return;
    // await setSearchFilters(page, { make_dropdown: 4, description: null });

    return;

}

async function scrapDataFromPages() {
    let data_arr = [];
    let hasNextPage = true;
    await setSearchFilters(page);
    console.log('after setSearchFilters');

    while (hasNextPage) {
        let containers_details = null;
        try {
            // Wait for the selector with a timeout of 10 seconds
            await Promise.race([
                page.waitForSelector('#digital_formula', { timeout: 10000 }),
                new Promise((resolve, reject) => setTimeout(() => reject(new Error('Timeout')), 10000))
            ]);
            // await page.waitForSelector('#digital_formula');
            containers_details = await page.$$eval('#digital_formula > .root', (elements) => {
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
        } catch (error) {
            // If the selector is not found within 10 seconds, exit the loop
            if (error.message === 'Timeout') {
                console.log('Timeout: #digital_formula not found within 10 seconds');
                break;
            } else {
                // Handle other errors if necessary
                console.error('Error setSearchFilters :', error);
                break;
            }
        }
        console.log('before container detail loop');

        for (let i = 0; i < containers_details.length; i++) {
            console.log('in container detail loop');
            const container = containers_details[i];
            const containerHandles = await page.$$('#digital_formula > .root');
            const hasMultitoneAccess = await containerHandles[i].$('.formula-multitone-access');
            let buttons = null;
            let extracted_data = {};
            if (hasMultitoneAccess) {
                console.log('multi tone found', container);
                // await setSearchFilters(multitone_page, { make_dropdown: 1, description: container.description });
                // filters_obj.description = container.description;
                await setSearchFilters(multitone_page, container.description);
                let hasNextMultiPage = true;
                while (hasNextMultiPage) {
                    buttons = await multitone_page.$$('#digital_formula > .root button[data-original-title="Color Information"]');
                    try {
                        // Wait for the selector with a timeout of 10 seconds
                        await Promise.race([
                            multitone_page.waitForSelector('#digital_formula', { timeout: 10000 }),
                            new Promise((resolve, reject) => setTimeout(() => reject(new Error('Timeout')), 10000))
                        ]);
                        // await page.waitForSelector('#digital_formula');
                        multitone_page_containers_details = await multitone_page.$$eval('#digital_formula > .root', (elements) => {
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
                    } catch (error) {
                        // If the selector is not found within 10 seconds, exit the loop
                        if (error.message === 'Timeout') {
                            console.log('Timeout: #digital_formula not found within 10 seconds');
                            break;
                        } else {
                            // Handle other errors if necessary
                            console.error('Error setSearchFilters :', error);
                            break;
                        }
                    }
                    
                    
                    for (let index_btn = 0; index_btn < buttons.length; index_btn++) {
                        extracted_data = await scrapDataFromList(multitone_page, multitone_page_containers_details[index_btn], buttons, index_btn, data_arr);
                        await saveToExcel([extracted_data], 'paint/sheets/paint.csv');
                    }
                    hasNextMultiPage = await goToNextPage(multitone_page);
                }
            }
            else {
                continue;
                extracted_data = await scrapDataFromList(page, container, buttons, i, data_arr);
                await saveToExcel([extracted_data], 'paint/sheets/paint.csv');

            }
            console.log('saving it to csv',[extracted_data]);
        }
        hasNextPage = await goToNextPage(page);
        // hasNextPage = false;
    }

    console.log('final scraped data data', data_arr);
    // await saveToExcel(data_arr, 'paint/paint.csv');
}

async function scrapDataFromList(listpage, container, buttons, i, data_arr) {
    console.log(`Processing scrapDataFromList 1`);
    let combinedData = {};

    buttons = await listpage.$$('#digital_formula > .root button[data-original-title="Color Information"]');

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
                combinedData = { ...container, ...scrap_detail };
                data_arr.push(combinedData);
            }
            infoColorUrl = `https://generalpaint.info/v2/search/formula-info?id=${id}`;
            detailColorUrl = `https://generalpaint.info/v2/search/family?id=${container.familyId}&sid=${container.sid}`;
            // console.log('infoColorUrl:', infoColorUrl);
            console.log('detailColorUrl:', detailColorUrl);

            // await scrapColorInfoData(id);
            // infoColorUrl = 'https://generalpaint.info/v2/search/formula-info?id=107573';
            // detailColorUrl = 'https://generalpaint.info/v2/search/family?id=67746&sid=67d00e248ae305.41320823';
        } else {
            console.error('Failed to extract URL and ID from onclick value');
        }
    }
    return combinedData;

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

async function saveToExcel_d(dataArray, fileName='paint/sheets/paint.csv') {
    const makeDropdown = await get_make_drop_down();
    let filePath= 'paint/sheets/';
    await fs.promises.mkdir(filePath, { recursive: true });
    fileName = `${filePath}/${makeDropdown[filters_obj.make_dropdown]}.csv`;
    const worksheet = xlsx.utils.json_to_sheet(dataArray);
    const workbook = xlsx.utils.book_new();
    xlsx.utils.book_append_sheet(workbook, worksheet, 'Paint Data');
    xlsx.writeFile(workbook, fileName);
    console.log(`Excel file saved as ${fileName}`);
}


async function saveToExcel(dataArray, fileName = 'paint/sheets/paint.csv') {
    console.log("excel 1");
    const makeDropdown = await get_make_drop_down();
    const filePath = 'paint/sheets/';
    console.log("excel 2");

    // Ensure the directory exists
    fs.mkdirSync(path.join('paint', 'sheets'), { recursive: true });
    console.log("excel 3");

    // Construct the full file path
    fileName = path.join(filePath, `${makeDropdown[filters_obj.make_dropdown]}.csv`);
    console.log("excel 4");

    // Clean dataArray: Remove newlines, line breaks, and tabs
    const cleanedDataArray = dataArray.map(row => {
        const cleanedRow = {};
        for (const key in row) {
            if (row.hasOwnProperty(key)) {
                // Replace newlines, line breaks, and tabs with a space or remove them
                cleanedRow[key] = row[key]
                    .replace(/\n/g, ' ') // Replace newlines with a space
                    .replace(/<br>/g, ' ') // Replace <br> with a space
                    .replace(/\t/g, ' '); // Replace tabs with a space
            }
        }
        return cleanedRow;
    });
    console.log('Cleaned Data:', cleanedDataArray);

    // Convert cleanedDataArray to CSV format
    const csvData = cleanedDataArray.map(row => {
        return Object.values(row).join(',');
    }).join('\n');

    // Append data to the file
    if (fs.existsSync(fileName)) {
        console.log("excel 5");

        // Append new data to the existing file
        fs.appendFileSync(fileName, `\n${csvData}`);
        console.log("excel 6");
    } else {
        console.log("excel 7");

        // Create a new file and write the header and data
        const header = Object.keys(cleanedDataArray[0]).join(',');
        fs.writeFileSync(fileName, `${header}\n${csvData}`);
        console.log("excel 8");
    }

    console.log(`Data appended to CSV file: ${fileName}`);
}

async function saveToExcelCreateSheet(dataArray, fileName='paint/sheets/paint.xlsx') {
    let workbook;
    let worksheet;
    const makeDropdown = await get_make_drop_down();
    console.log('makeDropdown:', makeDropdown);
    console.log('New Data:', dataArray);

    const sheetName = makeDropdown[filters_obj.make_dropdown]; // Dynamic sheet name
    let filePath= 'paint/sheets/';
    await fs.promises.mkdir(filePath, { recursive: true });
    fileName= filePath+sheetName+'.xlsx';
    // Check if the file already exists
    if (fs.existsSync(fileName)) {
        // Read the existing workbook
        workbook = xlsx.readFile(fileName);
        // Check if the sheet already exists
        if (workbook.Sheets[sheetName]) {
            // If the sheet exists, get the data and combine it with the new data
            worksheet = workbook.Sheets[sheetName];
            const existingData = xlsx.utils.sheet_to_json(worksheet);
            console.log('Existing Data:', existingData);
            const combinedData = existingData.concat(dataArray);
            console.log('Combined Data:', combinedData);

            // Update the existing sheet with the combined data
            xlsx.utils.sheet_add_json(worksheet, combinedData, { skipHeader: true, origin: -1 });
        } else {
            // If the sheet doesn't exist, create a new sheet
            console.log('Creating new sheet:', sheetName);
            worksheet = xlsx.utils.json_to_sheet(dataArray);
            xlsx.utils.book_append_sheet(workbook, worksheet, sheetName);
        }
    } else {
        // If the file doesn't exist, create a new workbook and worksheet
        console.log('Creating new workbook and sheet:', sheetName);
        workbook = xlsx.utils.book_new();
        worksheet = xlsx.utils.json_to_sheet(dataArray);
        xlsx.utils.book_append_sheet(workbook, worksheet, sheetName);
    }

    // Write the workbook to the file
    xlsx.writeFile(workbook, fileName);
    console.log(`Data saved to Excel file: ${fileName}, Sheet: ${sheetName}`);
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