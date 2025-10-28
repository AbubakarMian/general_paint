const express = require("express");
const { chromium } = require("playwright");
const cors = require("cors");
const fs = require("fs");
const path = require("path");
const { json, text } = require("stream/consumers");
const axios = require("axios");
const FormData = require("form-data");
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
let outputFilePath = null;
const xlsx = require("xlsx");
const { createCanvas } = require("canvas");
let current_filter_csv = "paint/current_filter_csv.csv";
let search_filter_param_csv = "paint/search_filter_param_csv.csv";
let all_completed_filter_csv = "paint/all_completed_filter_csv.csv";
const API_URL =
  "https://development.hatinco.com/scratchrepaircar/upload_shopify.php";

const MAX_RECURSION_DEPTH = 15;
const MAX_VISITED_ENTRIES = 1500000;
let visitedMultitones = new Set();
let currentRecursionDepth = 0;
let write_response = null;

async function loadUrl(retries = 1000) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      if (!browser) {
        browser = await chromium.launch({
          headless: false,
          args: [
            "--no-sandbox",
            "--disable-setuid-sandbox",
            "--disable-blink-features=AutomationControlled",
            "--disable-dev-shm-usage",
            "--disable-gpu",
            "--window-size=1280,720",
          ],
        });
        context = await browser.newContext();
        page = await browser.newPage();
        await page.setExtraHTTPHeaders({
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36",
        });
      }

      await page.goto("https://generalpaint.info/v2/site/login", {
        timeout: 90000,
      });
      await loginPage(page);

      new_page = await context.newPage();
      await new_page.goto("https://generalpaint.info/v2/site/login", {
        timeout: 90000,
      });
      await loginPage(new_page);
      randomWaitTime = getRandomNumber(1500, 3500);
      await new_page.waitForTimeout(randomWaitTime);

      multitone_page = await context.newPage();
      await multitone_page.goto("https://generalpaint.info/v2/site/login");
      return true;
    } catch (err) {
      if (browser && attempt % 5 === 0) {
        try {
          await browser.close();
        } catch (closeErr) {
          console.warn("Error closing browser:", closeErr);
        }
      }
      await new Promise((resolve) => setTimeout(resolve, 5000));
      console.error(`Attempt ${attempt} failed:`, err);
    } finally {
      //   if (browser) {
      //     try {
      //       await browser.close();
      //     } catch (closeErr) {
      //       console.warn("Error closing browser:", closeErr);
      //     }
      //   }
    }

    if (attempt < retries) {
      console.log(`Retrying... (${attempt + 1}/${retries})`);
    } else {
      throw new Error(`loadUrl failed after ${retries} attempts.`);
    }
  }
}

async function loginPage(page) {
  const LOGIN_URL = "https://generalpaint.info/v2/site/login";
  const SEARCH_URL = "https://generalpaint.info/v2/search";
  const LOGOUT_SELECTOR = 'form[action*="/v2/site/logout"]';
  const usernameSelector = "#loginform-username";
  const passwordSelector = "#loginform-password";
  const submitSelector = "[name='login-button']";

  // Check if we're already logged in
  try {
    // First ensure we're on a valid page
    if (!page.url().startsWith("https://generalpaint.info/v2/")) {
      // await page.goto(SEARCH_URL, { waitUntil: "domcontentloaded" });
      await page.goto(SEARCH_URL);
      await Promise.all([
        page.waitForSelector(usernameSelector, { visible: true }),
        page.waitForSelector(passwordSelector, { visible: true }),
        page.waitForSelector(submitSelector, { visible: true }),
      ]);
    }

    // Look for either logout form or user profile indicator
    await page.waitForSelector(LOGOUT_SELECTOR, { timeout: 9000 });
    console.log("Already logged in");
    return;
  } catch {
    console.log("Not logged in - proceeding with login");
  }

  try {
    await page.waitForSelector(usernameSelector, { timeout: 10000 });
    await page.fill(usernameSelector, "johnnybrownlee87");

    await page.waitForSelector(passwordSelector, { timeout: 10000 });
    await page.fill(passwordSelector, "7s1xpcnjqQ");

    page.click(submitSelector);
    await Promise.all([
      page.waitForNavigation({ waitUntil: "networkidle", timeout: 15000 }),
      page.click(submitSelector),
    ]);

    // Verify successful login
    try {
      await page.waitForSelector(LOGOUT_SELECTOR, { timeout: 5000 });
      console.log("Login successful");
    } catch {
      console.error("Login failed:", error);
      // throw new Error('Login verification failed - logout selector not found');
    }
  } catch (error) {
    console.error("Login failed:", error);
    // throw error; // Re-throw to handle in calling function
  }
}

function getRandomNumber(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}
function safeSplit(str, delimiter = ",") {
  if (!str) return [];
  return str
    .split(delimiter)
    .map((item) => item.trim())
    .filter((item) => item.length > 0)
    .sort();
}

app.get("/loadurl", async (req, res) => {
  try {
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders();
    write_response = res;
    console.log(`step 1 `);
    res.write(`data: [loggingIn]\n\n`);
    console.log(req.query);

    // Extract filter parameters
    outputFilePath = req.query.outputFilePath;

    // Process year parameter for ranges
    let year = req.query.year || null;
    let end_year = null;
    let allowed_years = [];
    let allowed_makes = safeSplit(req.query.make);
    let allowed_models = safeSplit(req.query.model);

    // Check if year is a range (e.g., "2024-2027" or "2027-2024")
    if (year && typeof year === "string" && year.includes("-")) {
      const years = year
        .split("-")
        .map((y) => parseInt(y.trim()))
        .filter((y) => !isNaN(y));

      if (years.length === 2) {
        year = Math.max(years[0], years[1]);
        end_year = Math.min(years[0], years[1]);
        for (let index_year = year; index_year >= end_year; index_year--) {
          allowed_years.push(index_year);
        }
        console.log(
          `Year range detected: ${years[0]}-${years[1]}, using year: ${year}, end_year: ${end_year}`
        );
      }
    } else if (year) {
      year = parseInt(year);
      end_year = year;
      allowed_years = [year];
    }

    const filters_search = {
      outputFilePath: req.query.outputFilePath || null,
      make: allowed_makes.length > 0 ? allowed_makes[0] : null, // Use the processed array
      year: year,
      end_year: end_year,
      allowed_years: allowed_years,
      allowed_makes: allowed_makes,
      allowed_models: allowed_models,
      model: allowed_models.length > 0 ? allowed_models[0] : null, // Use the processed array
      plastic_parts: req.query.related_colors || 0,
      groupdesc: req.query.color_family || 0,
      effect: req.query.solid_effect || 0,
    };

    const current_search = {
      // outputFilePath: req.query.outputFilePath || null,
      make: allowed_makes.length > 0 ? allowed_makes[0] : null, // Use the processed array
      year: year,
      // allowed_years: allowed_years,
      // allowed_makes: allowed_makes,
      // allowed_models: allowed_models,
      model: allowed_models.length > 0 ? allowed_models[0] : null, // Use the processed array
      plastic_parts: req.query.related_colors || 0,
      groupdesc: req.query.color_family || 0,
      effect: req.query.solid_effect || 0,
      end_year: end_year,
    };
    console.log("outputFilePath", req.query.outputFilePath);
    console.log("all query", req.query);
    console.log("processed year filters:", {
      year: filters_search.year,
      end_year: filters_search.end_year,
    });
    console.log("processed makes:", allowed_makes);
    console.log("processed models:", allowed_models);

    // Validate required fields
    if (!filters_search.outputFilePath) {
      res.write(`data: [ERROR: Output file path is required]\n\n`);
      res.end();
      return;
    }

    let logged_in = await loadUrl();

    // Set filters and create/update CSV
    if (logged_in) {
      res.write(`data: [StartingsetFiltersAndUpdateCSVsuccess]\n\n`);
      const currentfilterSetSuccess = await setFiltersAndUpdateCSV(
        current_search
      );
      res.write(`data: [loadurlSuccess]\n\n`);
      const filterSetSuccess = await writeCurrentSearchFiltersParametersToCsv(
        filters_search
      );
      if (!currentfilterSetSuccess) {
        res.write(
          `data: [ERROR: Failed to currentfilterSetSuccess filters]\n\n`
        );
      }
      if (!filterSetSuccess) {
        res.write(`data: [ERROR: Failed to set filters]\n\n`);
      }
      return;
    } else {
      res.write(`data: [ERRORURLNOTLOADED]\n\n`);
      res.end();
    }
  } catch (error) {
    console.error(`Error in /loadurl route: ${error.message}`);
    res.write(`data: [ERROR]\n\n`);
    res.end();
  }
});

async function setFiltersAndUpdateCSV(filters_search) {
  try {
    // filters_obj = filters_search;
    let randomWaitTime = getRandomNumber(5000, 6500);

    if (filters_search.make) {
      await page.selectOption("#make_dropdown", {
        label: filters_search.make,
      });
    }
    await page.waitForTimeout(randomWaitTime);
    if (filters_search.year) {
      await page.selectOption("#year", {
        label: filters_search.year.toString(),
      });
    }
    await page.waitForTimeout(randomWaitTime);
    if (filters_search.model) {
      await page.evaluate((model) => {
        $("#models_dropdown").selectpicker("val", model);
      }, filters_search.model);
    }
    console.log("Setting filters and updating CSV...", filters_search);

    const filterRow = await buildFilterRow(filters_search);

    writeCurrentRowToCsv(filterRow);

    console.log("✓ Filters set and CSV updated successfully");
    return true;
  } catch (error) {
    console.error("❌ Error setting filters:", error);
    return false;
  }
}
// Function to build the filter row with indices
async function buildFilterRow(filters_search) {
  try {
    console.log("Building filter row with indices...");

    // Find indices for each enabled filter
    const makeIndex = await findDropdownIndex(
      "#make_dropdown",
      filters_search.make
    );
    const yearIndex = await findDropdownIndex("#year", filters_search.year);
    const modelIndex = await findDropdownIndex(
      "#models_dropdown",
      filters_search.model
    );
    const relatedColorsIndex = await findDropdownIndex(
      "#related_colors_dropdown",
      filters_search.related_colors
    );
    const colorFamilyIndex = await findDropdownIndex(
      "#color_family_dropdown",
      filters_search.color_family
    );
    const solidEffectIndex = await findDropdownIndex(
      "#solid_effect_dropdown",
      filters_search.solid_effect
    );
    const csvRow = `${makeIndex},${filters_search.make || ""},${yearIndex},${
      filters_search.year || ""
    },${modelIndex},${filters_search.model || ""},${relatedColorsIndex},${
      filters_search.plastic_parts || ""
    },${colorFamilyIndex},${
      filters_search.groupdesc || ""
    },${solidEffectIndex},${filters_search.effect || ""}`;

    console.log("✓ Filter row built:", csvRow);
    return csvRow;
  } catch (error) {
    console.error("❌ Error building filter row:", error);
    throw error;
  }
}

async function uploadSingle(row_values_obj) {
  let image_path = row_values_obj.image_path;
  const form = new FormData();
  const stream = fs.createReadStream(image_path);
  console.log("uploadSingle file", image_path);
  console.log("uploadSingle row_values_obj", row_values_obj);

  if (!fs.existsSync(image_path)) {
    console.error("File does not exist:", image_path);
    return { success: false, error: "File does not exist", imageSrc: null };
  }
  if (!fs.statSync(image_path).isFile()) {
    console.error("Not a valid file:", image_path);
    return { success: false, error: "Not a valid file", imageSrc: null };
  }

  stream.on("error", (err) => console.error("Stream error:", err));

  form.append("brand", row_values_obj.make);
  form.append("models", row_values_obj.model);
  form.append("year", row_values_obj.year);
  form.append("color_name", row_values_obj.color);
  form.append("paint_codes", row_values_obj.colorCode);
  form.append("price", 9.95);
  form.append("compare_price", 0.0);

  // ✅ CORRECT: This is the right way to append the file
  form.append("images[]", fs.createReadStream(image_path));

  try {
    console.log("Uploading single file:", image_path); // Fixed variable name
    const res = await axios.post(API_URL, form, {
      headers: {
        ...form.getHeaders(),
        Accept: "*/*",
        Origin: "https://development.hatinco.com",
        Referer:
          "https://development.hatinco.com/scratchrepaircar/upload_brand.php",
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36",
      },
      maxBodyLength: Infinity,
      maxContentLength: Infinity,
      timeout: 60000,
    });

    console.log("Response data step 15:", JSON.stringify(res.data, null, 2));
    console.log("Single upload response:", res.status, res.statusText);

    let parsedFiles = null;
    if (res.data && res.data.files) {
      try {
        parsedFiles =
          typeof res.data.files === "string"
            ? JSON.parse(res.data.files)
            : res.data.files;
      } catch (e) {
        console.error("Failed to parse files JSON:", e.message);
      }
    }

    console.log("Parsed files:", JSON.stringify(parsedFiles, null, 2));
    if (res.data.errors && res.data.errors.length > 0) {
      console.warn("Server returned errors:", res.data.errors);
    }

    await sleep(2000);

    // Extract image src
    const src = parsedFiles?.[0]?.upload?.response?.image?.src || null;

    if (!src) {
      logFailure(
        image_path,
        `server reported failure: ${JSON.stringify(res.data).slice(0, 200)}`
      );
      return {
        success: false,
        error: "Upload failed - no image source returned",
        imageSrc: null,
      };
    } else {
      console.log("Single upload successful:", image_path, "->", src);
      return { success: true, imageSrc: src, error: null };
    }
  } catch (err) {
    console.error("Single upload error for", image_path, err && err.message);
    if (err && err.response) {
      console.error("Response status:", err.response.status);
      try {
        console.error(
          "Response data (truncated):",
          JSON.stringify(err.response.data).slice(0, 1500)
        );
      } catch (e) {
        console.error(
          "Response data:",
          String(err.response.data).slice(0, 1500)
        );
      }
    }
    logFailure(image_path, err && err.message ? err.message : "unknown error");

    await sleep(2000);
    return { success: false, error: err.message, imageSrc: null };
  } finally {
    try {
      stream.destroy();
    } catch (e) {}
  }
}
function sleep(ms) {
  return new Promise((res) => setTimeout(res, ms));
}
async function findDropdownIndex(selector, text) {
  try {
    text = String(text || "");
    // Return index 0 for empty/missing text
    if (!text || text.trim() === "") {
      console.log(`No text provided for ${selector}, returning index 0`);
      return 0;
    }

    console.log(`Looking for option "${text}" in dropdown ${selector}`);

    await page.waitForSelector(selector, { timeout: 10000 });

    const result = await page.evaluate(
      ({ selector, searchText }) => {
        const dropdown = document.querySelector(selector);
        if (!dropdown) {
          return { error: `Dropdown with selector ${selector} not found` };
        }

        const options = dropdown.options;
        const availableOptions = [];

        console.log(`Available options in ${selector}:`);
        for (let i = 0; i < options.length; i++) {
          availableOptions.push({
            index: i,
            text: options[i].text.trim(),
            value: options[i].value,
          });
          console.log(
            `  [${i}] "${options[i].text.trim()}" (value: ${options[i].value})`
          );
        }

        // If no options or only empty option, return 0
        if (
          options.length === 0 ||
          (options.length === 1 && options[0].text.trim() === "")
        ) {
          return { index: 0, matchType: "default", matchedText: "" };
        }

        // Normalize search text
        const normalizedSearchText = searchText.trim().toLowerCase();

        // Strategy 1: Exact match (case insensitive)
        for (let i = 0; i < options.length; i++) {
          if (options[i].text.trim().toLowerCase() === normalizedSearchText) {
            return {
              index: i,
              matchType: "exact",
              matchedText: options[i].text.trim(),
            };
          }
        }

        // Strategy 2: Contains match
        for (let i = 0; i < options.length; i++) {
          if (
            options[i].text.trim().toLowerCase().includes(normalizedSearchText)
          ) {
            return {
              index: i,
              matchType: "contains",
              matchedText: options[i].text.trim(),
            };
          }
        }

        // Strategy 3: Value match
        for (let i = 0; i < options.length; i++) {
          if (options[i].value.trim().toLowerCase() === normalizedSearchText) {
            return {
              index: i,
              matchType: "value",
              matchedText: options[i].text.trim(),
            };
          }
        }

        // Strategy 4: Fuzzy match (if no other matches found)
        for (let i = 0; i < options.length; i++) {
          const optionText = options[i].text.trim().toLowerCase();
          if (
            optionText.includes(normalizedSearchText) ||
            normalizedSearchText.includes(optionText)
          ) {
            return {
              index: i,
              matchType: "fuzzy",
              matchedText: options[i].text.trim(),
            };
          }
        }

        // If no match found, return index 0 (default/empty option)
        console.log(`No match found for "${searchText}", returning index 0`);
        return {
          index: 0,
          matchType: "default",
          matchedText: options[0]?.text.trim() || "",
        };
      },
      { selector, searchText: text }
    );

    if (result.error) {
      console.warn(
        `Warning for ${selector}: ${result.error}. Returning index 0`
      );
      return 0;
    }

    console.log(
      `✓ Found option "${text}" at index ${result.index} (${result.matchType} match) - "${result.matchedText}"`
    );
    return result.index;
  } catch (error) {
    console.error(
      `❌ Error finding dropdown index for "${text}" in ${selector}:`,
      error.message
    );
    console.warn(`Returning index 0 as fallback`);

    // Debugging
    try {
      const availableOptions = await page.evaluate((selector) => {
        const dropdown = document.querySelector(selector);
        if (!dropdown) return "Dropdown not found";

        const options = [];
        for (let i = 0; i < dropdown.options.length; i++) {
          options.push({
            index: i,
            text: dropdown.options[i].text.trim(),
            value: dropdown.options[i].value,
          });
        }
        return options;
      }, selector);

      console.log(`Available options in ${selector}:`, availableOptions);
    } catch (debugError) {
      console.error(
        "Could not retrieve available options for debugging:",
        debugError
      );
    }

    return 0; // Return 0 instead of throwing error
  }
}
async function scrapFormaulaDetailsData(container) {
  let sid = container.sid;
  let id = container.familyId;
  console.log("its container scrapFormaulaDetailsData : ", container);
  let load_url =
    "https://generalpaint.info/v2/search/family?id=" + id + "&sid=" + sid;
  await new_page.goto(load_url);
  randomWaitTime = getRandomNumber(3500, 5500);
  await new_page.waitForTimeout(randomWaitTime);
  await new_page.waitForSelector(".container.mt-4");
  let color_paths = await downloadSearchFamilyCanvasImage(sid, id, new_page);
  console.log("multiple colors : ", color_paths);
  let colorCode = parsePaintInfo(container.content).code;
  // let colorCode = parsePaintInfo(item.content).code;
  const data = await new_page.evaluate(
    ({ color_paths, colorCode }) => {
      const results = [];
      const formulaH2 = document.querySelector(".formula-h2");
      const yearColorText = formulaH2 ? formulaH2.innerText.trim() : "";
      const [year, color] = yearColorText
        .split("\n")
        .map((text) => text.trim());
      const detailsElement = document.querySelector(".formula-info");
      const details = detailsElement
        ? detailsElement.getAttribute("data-original-title")
        : "";
      const trElements = document.querySelectorAll("tbody tr");
      trElements.forEach((tr, index) => {
        const toneElement = Array.from(tr.querySelectorAll(".formula-h1")).find(
          (el) => el.innerText.includes("Tone")
        )?.nextElementSibling;
        const tone = toneElement ? toneElement.innerText.trim() : "";
        let panelNoElement = Array.from(
          tr.querySelectorAll(".formula-h1")
        ).find((el) => el.innerText.includes("Panel no."))?.nextElementSibling;
        let panelNo = panelNoElement ? panelNoElement.innerText.trim() : "";
        if (!panelNo) {
        }
        console.log("panel no ", panelNo);
        const canvasWrapper = tr.querySelector("#canvas_wrapper");
        let bgColor = "";

        if (canvasWrapper) {
          const canvas = canvasWrapper.querySelector("canvas");
          if (canvas) {
            const ctx = canvas.getContext("2d");
            const imageData = ctx.getImageData(0, 0, 1, 1).data; // Get pixel data from the top-left corner
            bgColor = `rgba(${imageData[0]}, ${imageData[1]}, ${
              imageData[2]
            }, ${imageData[3] / 255})`;
          } else {
            bgColor = window.getComputedStyle(canvasWrapper).backgroundColor;
          }
        }
        results.push({
          year,
          color,
          colorCode,
          tone,
          panelNo,
          details,
          bgColor,
          image_path: color_paths[index] || null, // Use the corresponding image path
        });
      });

      return results;
    },
    { color_paths, colorCode }
  ); // Pass color_paths as an argument to evaluate

  return data;
}

async function downloadSearchFamilyCanvasImage(sid, id, canvas_page) {
  const canvasImages = await canvas_page.evaluate(async () => {
    const images = [];
    const trElements = document.querySelectorAll("tbody tr");

    trElements.forEach((tr, index) => {
      const canvas = tr.querySelector("canvas");
      const div = tr.querySelector("#canvas_wrapper");

      if (canvas) {
        const image = canvas.toDataURL("image/png");
        images.push({ index, image });
      } else if (div) {
        const canvasElement = document.createElement("canvas");
        const ctx = canvasElement.getContext("2d");
        canvasElement.width = div.offsetWidth;
        canvasElement.height = div.offsetHeight;
        const bgColor = window.getComputedStyle(div).backgroundColor;
        ctx.fillStyle = bgColor;
        ctx.fillRect(0, 0, canvasElement.width, canvasElement.height);
        const image = canvasElement.toDataURL("image/png");
        images.push({ index, image });
      }
    });

    return images;
  });
  let images_arr = [];
  for (const { index, image } of canvasImages) {
    let random_number = getRandomNumber(10000, 99999);
    let uniq_name = getUniqueName(`${random_number}_${id}_${sid}_${index}.png`);
    const base64Data = image.replace(/^data:image\/png;base64,/, "");
    let color_path = await getColorPath();

    let imagePath = path.join(color_path, uniq_name);
    images_arr.push(imagePath);
    fs.writeFileSync(imagePath, base64Data, "base64", (err) => {
      if (err) console.error(`Error saving image ${index}:`, err);
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
    "paint",
    "colors",
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
  let load_url = "https://generalpaint.info/v2/search/formula-info?id=" + id;
  await new_page.goto(load_url);
  randomWaitTime = getRandomNumber(3500, 5500);
  await page.waitForTimeout(randomWaitTime);
  await new_page.waitForSelector(".container.mt-4");
  await downloadSearchFamilyCanvasImage(new_page);
  const data = await new_page.evaluate(() => {
    const container = document.querySelector(".container.mt-4");
    if (!container) return null;
    const yearAndColor =
      container.querySelector(".formula-h2")?.innerHTML.trim() || null;
    const tone =
      container.querySelector("td span.formula-h2")?.innerText.trim() || null;
    const panelNo =
      container
        .querySelector("td span.formula-h2:nth-of-type(2)")
        ?.innerText.trim() || null;
    const details =
      container.querySelector("td:nth-child(3)")?.innerHTML.trim() || null;
    const canvasWrapper = container.querySelector("#canvas_wrapper");
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
      console.log("setSearchFilters filters", filters);

      let randomWaitTime = getRandomNumber(1000, 1500);

      await selected_page.waitForSelector("#make_dropdown", { timeout: 5000 });

      if (filters.make != null) {
        await selected_page.selectOption("#make_dropdown", {
          index: filters.make,
        });
        await selected_page.evaluate(() => {
          // ensure trigger the change event
          const el = document.querySelector("#make_dropdown");
          el.dispatchEvent(new Event("change", { bubbles: true }));
        });
        await get_model_drop_down(selected_page, filters);
      }
      if (filters.year != null) {
        await selected_page.selectOption("#year", { index: filters.year });
      }
      if (filters.plastic_parts != null) {
        // clear selections
        // await selected_page.selectOption("#plastic_parts", []);
        // if (filters.plastic_parts > 2) {
        //   await selected_page.selectOption("#plastic_parts", {
        //     index: filters.plastic_parts - 1,
        //   });
        // }
        if (filters.plastic_parts != null) {
          const check = await checkDependentChange(
            selected_page,
            "#plastic_parts",
            ["#models_dropdown"], // dependent dropdowns to monitor
            async () => {
              await selected_page.selectOption("#plastic_parts", []);
              if (filters.plastic_parts > 2) {
                await selected_page.selectOption("#plastic_parts", {
                  index: filters.plastic_parts - 1,
                });
              }
            }
          );

          if (check.result === false) {
            console.log("Change detected:", check);
            return false; // stop or handle it as you like
          }
        }
      }
      if (filters.groupdesc != null) {
        const check = await checkDependentChange(
          selected_page,
          "#groupdesc",
          ["#plastic_parts", "#models_dropdown"],
          async () => {
            await selected_page.selectOption("#groupdesc", {
              index: filters.groupdesc,
            });
          }
        );

        if (!check.result) {
          console.log("Change detected:", check);
          return false;
        }
      }
      if (filters.effect != null) {
        const check = await checkDependentChange(
          selected_page,
          "#effect",
          ["#plastic_parts", "#models_dropdown", "#groupdesc"],
          async () => {
            await selected_page.selectOption("#effect", {
              index: filters.effect,
            });
          }
        );

        if (!check.result) {
          console.log("Change detected:", check);
          return false;
        }
      }
      if (filters.description != null) {
        console.log("in filter description:");
        await selected_page.fill("#description", filters.description);
      }

      await selected_page.waitForTimeout(500);

      await selected_page.click(".btn.btn-success.btn-lg.mr-3");

      await selected_page.waitForTimeout(randomWaitTime);
      return; // ✅ success, exit function
    } catch (error) {
      console.error(
        "Error in setSearchFilters attempt",
        try_to_load + 1,
        ":",
        error
      );
      await selected_page.goto("https://generalpaint.info/v2/search");
      await loginPage(selected_page);
      await selected_page.waitForTimeout(5000);
      continue; // ✅ retry next loop
    }
  }
  return;
}

const getCurrentPageNumber = async (nextpage) => {
  try {
    const activePageItem = await nextpage.$(".pagination li.active");
    if (!activePageItem) {
      return 1;
    } else {
      const pageNumber = await page.evaluate((el) => {
        const link = el.querySelector("a.page-link");
        return link ? parseInt(link.textContent, 10) : null;
      }, activePageItem);

      return pageNumber;
    }
  } catch (error) {
    console.error("Error in getCurrentPageNumber page number:", error);
    return 1;
    throw error;
  }
};
const goToNextPage = async (page) => {
  try {
    // Get the active page item
    const activePageItem = await page.$(".pagination li.active");
    if (!activePageItem) {
      console.log("No active page found");
      return false;
    }

    // Get the next page item
    const nextPageItem = await activePageItem.evaluateHandle(
      (el) => el.nextElementSibling
    );
    const nextPageElement = await nextPageItem.asElement();

    // If no next sibling exists, we're on the last page
    if (!nextPageElement) {
      console.log("Already on last page - no next sibling");
      return false;
    }

    // Check if the next item is actually a page item (not some other element)
    const isPageItem = await nextPageElement.evaluate((el) =>
      el.classList.contains("page-item")
    );
    if (!isPageItem) {
      console.log("Next element is not a page item");
      return false;
    }

    // Click the next page link
    const nextPageLink = await nextPageElement.$("a.page-link");
    if (!nextPageLink) {
      console.log("No page link found in next item");
      return false;
    }

    await Promise.all([
      nextPageLink.click(),
      // page.waitForNavigation({ waitUntil: 'networkidle0' })
    ]);

    // Verify we have content on the new page
    // await page.waitForSelector('#digital_formula', { timeout: 10000 });
    await has_digital_formula(page, "#digital_formula");

    return true;
  } catch (error) {
    console.error("Error navigating to next page:", error.message);
    return false;
  }
};

async function get_make_drop_down() {
  return [
    //248
    "Manufacturer",
    "ACURA",
    "AFNOR",
    "AIWAYS",
    "AIXAM",
    "ALFA ROMEO",
    "ALPINE",
    "AMERICAN MOTORS",
    "APRILIA MOTO",
    "ARO",
    "ASIA",
    "ASTON MARTIN",
    "AUDI",
    "AVATR",
    "BAIC",
    "BEDFORD",
    "BELLIER",
    "BENELLI MOTO",
    "BENTLEY",
    "BERKLEY",
    "BERLIET",
    "BERTONE",
    "BMW",
    "BMW MOTO",
    "BORGWARD",
    "BRILLIANCE",
    "BS2660",
    "BS381C",
    "BS4800",
    "BS5252",
    "BUERSTNER",
    "BUGATTI",
    "BYD AUTO",
    "CASALINI",
    "CATERHAM CARS",
    "CHANGAN",
    "CHATENET",
    "CHERY",
    "CHEVROLET EUR_",
    "CHRYSLER",
    "CITROEN",
    "CLUB CAR",
    "COMM_VEH_USA",
    "DACIA",
    "DAEWOO",
    "DAEWOO IRAN",
    "DAF TRUCKS",
    "DAIHATSU",
    "DANEMARK STAND",
    "DATSUN",
    "DENZA",
    "DERBI MOTO",
    "DHL EXPRESS",
    "DKW",
    "DONGFENG AUTO",
    "DR AUTOMOBILES",
    "DR MOTOR COMPANY",
    "DUCATI MOTO",
    "EDSEL",
    "ERF",
    "FACEL VEGA",
    "FAW HONGQI",
    "FCS",
    "FERRARI",
    "FIAT_LANCIA",
    "FINLANDE STAN",
    "FISKER",
    "FLEET",
    "FLEET GERMANY",
    "FLEET_AUSTRALIA",
    "FLEET_FRANCE",
    "FLEET_SAUDI AR",
    "FLEET_SPAIN",
    "FLEET_UK",
    "FORD EUROPE",
    "FORD_S_AFRICA",
    "FORD_USA",
    "FORD_AUSTRALIA",
    "FOTON",
    "FREIGHTLINER",
    "FSO",
    "GAC MOTOR",
    "GAT",
    "GAZ",
    "GEELY",
    "GENERAL MOTORS",
    "GEO",
    "GILERA MOTORCYCLES",
    "GREATWALL AUTO",
    "GROOVE",
    "HAFEI",
    "HAIMA",
    "HANOMAG",
    "HARLEY_DAVIDSON",
    "HAVAL",
    "HIPHI",
    "HKS",
    "HOLDEN",
    "HONDA",
    "HONDA MOTO",
    "HOZON AUTO",
    "HUMMER",
    "HYCAN",
    "HYUNDAI",
    "IM MOTORS",
    "INEOS AUTOMOTIVE",
    "INFINITI",
    "INNOCENTI",
    "ISUZU",
    "IVECO",
    "JAC MOTORS",
    "JAGUAR",
    "JENSEN",
    "JETOUR",
    "KARMA AUTO",
    "KAWASAKI MOTO",
    "KIA",
    "KTM MOTO",
    "KYMCO MOTO",
    "LADA",
    "LAMBORGHINI",
    "LAMBRETTA",
    "LAND ROVER",
    "LATAMMO MOTO",
    "LDV",
    "LEADING IDEAL",
    "LEAP MOTOR",
    "LEVDEO",
    "LEXUS",
    "LEYLAND",
    "LI AUTO",
    "LIFAN",
    "LIGIER",
    "LML",
    "LONDON ELECTRIC VEHICLE C",
    "LONDON TAXI",
    "LOTUS",
    "LUCID MOTORS",
    "LUXGEN",
    "LYNK AND CO",
    "MAGIRUS",
    "MAHINDRA",
    "MALAGUTI MOTO",
    "MAN",
    "MARUTI",
    "MASERATI",
    "MATRA",
    "MAZDA",
    "MCLAREN",
    "MERCEDES",
    "MERCEDES TRUCKS",
    "MG",
    "MICROCAR",
    "MIDDLEBRIDGE",
    "MINI",
    "MITSUBISHI",
    "MITSUBISHI TRUCKS",
    "MORGAN",
    "MOSKVITCH",
    "MOTO GUZZI MOTORCYCLES",
    "MOTORCYCLES",
    "NAVISTAR",
    "NCS",
    "NIO",
    "NISSAN",
    "NISSAN S_AFRICA",
    "NORMAS UNE",
    "ODA",
    "OPEL S_AFRICA",
    "OPEL_VAUXHALL",
    "OTHER",
    "PANHARD",
    "PANTONE",
    "PERODUA",
    "PEUGEOT",
    "PEUGEOT MOTO",
    "PIAGGIO MOTO",
    "POLESTAR",
    "POLESTONES",
    "PORSCHE",
    "PRIMER",
    "PROTON",
    "QOROS",
    "RAL",
    "RAL DESIGN",
    "RELIANT",
    "RENAULT",
    "RENAULT TRUCKS",
    "RIVIAN",
    "ROEWE",
    "ROLLS ROYCE",
    "ROOTES",
    "ROVER",
    "ROX",
    "SAAB",
    "SAIC_GM",
    "SAIPA",
    "SAMSUNG",
    "SANTANA",
    "SCANIA TRUCKS",
    "SEAT",
    "SERES",
    "SETRA",
    "SINOTRUK",
    "SKODA",
    "SKYWELL",
    "SMART",
    "SOUEAST",
    "SPECTRUM",
    "SSANGYONG",
    "STUDEBAKER",
    "SUBARU",
    "SUZUKI",
    "SUZUKI MOTO",
    "SWM MOTORS",
    "TALBOT",
    "TATA",
    "TATRA TRUCKS",
    "TESLA MOTORS",
    "TOYOTA",
    "TOYOTA S_AFRICA",
    "TOYOTA TRUCKS",
    "TRABANT",
    "TRIUMPH",
    "TRIUMPH MOTO",
    "TVR",
    "UAZ",
    "UMM",
    "VESPA",
    "VOLGA",
    "VOLKSWAGEN",
    "VOLVO",
    "VOLVO TRUCKS",
    "VORTEX",
    "VOYAH",
    "VSLF_USVC",
    "VW BRAZIL",
    "VW SHANGHAI",
    "WARTBURG",
    "WEY",
    "WM MOTOR",
    "WULING",
    "XPENG MOTORS",
    "YAMAHA MOTO",
    "YUGO",
    "ZAZ",
    "ZEEKR",
    "ZOTYE",
    // "Manufacturer", "ACURA", "AFNOR" //"AIWAYS", "AIXAM", "ALFA ROMEO", "ALPINE", "AMERICAN MOTORS", "APRILIA MOTO", "ARO", "ASIA", "ASTON MARTIN", "AUDI", "AVATR", "BAIC", "BEDFORD", "BELLIER", "BENELLI MOTO", "BENTLEY", "BERKLEY", "BERLIET", "BERTONE", "BMW", "BMW MOTO", "BORGWARD", "BRILLIANCE", "BS2660", "BS381C", "BS4800", "BS5252", "BUERSTNER", "BUGATTI", "BYD AUTO", "CASALINI", "CATERHAM CARS", "CHANGAN", "CHATENET", "CHERY", "CHEVROLET EUR.", "CHRYSLER", "CITROEN", "CLUB CAR", "COMM.VEH.USA", "DACIA", "DAEWOO", "DAEWOO IRAN", "DAF TRUCKS", "DAIHATSU", "DANEMARK STAND", "DATSUN", "DENZA", "DERBI MOTO", "DHL EXPRESS", "DKW", "DONGFENG AUTO", "DR AUTOMOBILES", "DR MOTOR COMPANY", "DUCATI MOTO", "EDSEL", "ERF", "FACEL VEGA", "FAW HONGQI", "FCS", "FERRARI", "FIAT/LANCIA", "FINLANDE STAN", "FISKER", "FLEET", "FLEET GERMANY", "FLEET-AUSTRALIA", "FLEET-FRANCE", "FLEET-SAUDI AR", "FLEET-SPAIN", "FLEET-UK", "FORD EUROPE", "FORD-S.AFRICA", "FORD-USA", "FORD_AUSTRALIA", "FOTON", "FREIGHTLINER", "FSO", "GAC MOTOR", "GAT", "GAZ", "GEELY", "GENERAL MOTORS", "GEO", "GILERA MOTORCYCLES", "GREATWALL AUTO", "GROOVE", "HAFEI", "HAIMA", "HANOMAG", "HARLEY-DAVIDSON", "HAVAL", "HIPHI", "HKS", "HOLDEN", "HONDA", "HONDA MOTO", "HOZON AUTO", "HUMMER", "HYCAN", "HYUNDAI", "IM MOTORS", "INEOS AUTOMOTIVE", "INFINITI", "INNOCENTI", "ISUZU", "IVECO", "JAC MOTORS", "JAGUAR", "JENSEN", "JETOUR", "KARMA AUTO", "KAWASAKI MOTO", "KIA", "KTM MOTO", "KYMCO MOTO", "LADA", "LAMBORGHINI", "LAMBRETTA", "LAND ROVER", "LATAMMO MOTO", "LDV", "LEADING IDEAL", "LEAP MOTOR", "LEVDEO", "LEXUS", "LEYLAND", "LI AUTO", "LIFAN", "LIGIER", "LML", "LONDON ELECTRIC VEHICLE C", "LONDON TAXI", "LOTUS", "LUCID MOTORS", "LUXGEN", "LYNK AND CO", "MAGIRUS", "MAHINDRA", "MALAGUTI MOTO", "MAN", "MARUTI", "MASERATI", "MATRA", "MAZDA", "MCLAREN", "MERCEDES", "MERCEDES TRUCKS", "MG", "MICROCAR", "MIDDLEBRIDGE", "MINI", "MITSUBISHI", "MITSUBISHI TRUCKS", "MORGAN", "MOSKVITCH", "MOTO GUZZI MOTORCYCLES", "MOTORCYCLES", "NAVISTAR", "NCS", "NIO", "NISSAN", "NISSAN S.AFRICA", "NORMAS UNE", "ODA", "OPEL S.AFRICA", "OPEL/VAUXHALL", "OTHER", "PANHARD", "PANTONE", "PERODUA", "PEUGEOT", "PEUGEOT MOTO", "PIAGGIO MOTO", "POLESTAR", "POLESTONES", "PORSCHE", "PRIMER", "PROTON", "QOROS", "RAL", "RAL DESIGN", "RELIANT", "RENAULT", "RENAULT TRUCKS", "RIVIAN", "ROEWE", "ROLLS ROYCE", "ROOTES", "ROVER", "ROX", "SAAB", "SAIC-GM", "SAIPA", "SAMSUNG", "SANTANA", "SCANIA TRUCKS", "SEAT", "SERES", "SETRA", "SINOTRUK", "SKODA", "SKYWELL", "SMART", "SOUEAST", "SPECTRUM", "SSANGYONG", "STUDEBAKER", "SUBARU", "SUZUKI", "SUZUKI MOTO", "SWM MOTORS", "TALBOT", "TATA", "TATRA TRUCKS", "TESLA MOTORS", "TOYOTA", "TOYOTA S.AFRICA", "TOYOTA TRUCKS", "TRABANT", "TRIUMPH", "TRIUMPH MOTO", "TVR", "UAZ", "UMM", "VESPA", "VOLGA", "VOLKSWAGEN", "VOLVO", "VOLVO TRUCKS", "VORTEX", "VOYAH", "VSLF/USVC", "VW BRAZIL", "VW SHANGHAI", "WARTBURG", "WEY", "WM MOTOR", "WULING", "XPENG MOTORS", "YAMAHA MOTO", "YUGO", "ZAZ", "ZEEKR", "ZOTYE"
  ];
}

async function get_model_drop_down(selected_page = null, filters) {
  let randomWaitTime = getRandomNumber(2500, 3500);
  await selected_page.waitForTimeout(randomWaitTime);
  console.log("now selecting model drop down");
  let models = await selected_page.$$eval(
    "#models_dropdown option",
    (options) => {
      console.log("options model drop down : ", options);
      return options.map((o) => o.textContent.trim());
    }
  );
  if (selected_page && filters.model !== null) {
    await selected_page.waitForTimeout(randomWaitTime);
    // console.log("models selection : ", filters.model);
    // console.log("all models selection : ", models);

    let model_drop_down_text = filters.model_text ?? models[filters.model];
    // console.log("model_drop_down_text : ", model_drop_down_text);
    if (model_drop_down_text) {
      // await selected_page.selectOption("#models_dropdown", {
      //   label: model_drop_down_text,
      //   // label: filters.model_text,
      // });
      // await selected_page.evaluate(() => {// ensure trigger the change event
      //   const el = document.querySelector("#models_dropdown");
      //   el.dispatchEvent(new Event("change", { bubbles: true }));
      // });
      await selected_page.evaluate((text) => {
        // combination of above code Finds the option by its label.Sets it as selected.Triggers the change event.
        const el = document.querySelector("#models_dropdown");
        el.value = [...el.options].find((o) => o.label === text)?.value || "";
        el.dispatchEvent(new Event("change", { bubbles: true }));
      }, model_drop_down_text);
    }

    // await selected_page.selectOption('#models_dropdown', { index: filters.model });
  }
  console.log("setting models in _models_drop_down : ", models);
  _models_drop_down = models;
  return models;
}
async function checkDependentChange(
  selected_page,
  triggerSelector,
  dependentSelectors,
  selectCallback
) {
  // Take snapshots before change
  const before = {};
  for (const sel of dependentSelectors) {
    before[sel] = await selected_page.$$eval(`${sel} option`, (opts) =>
      opts.map((o) => o.textContent.trim())
    );
  }

  // Execute dropdown change (your logic)
  await selectCallback();

  // Give time for AJAX/DOM updates
  await selected_page.waitForTimeout(1500);

  // Take snapshots after change
  const after = {};
  for (const sel of dependentSelectors) {
    after[sel] = await selected_page.$$eval(`${sel} option`, (opts) =>
      opts.map((o) => o.textContent.trim())
    );
  }

  // Compare
  for (const sel of dependentSelectors) {
    const changed = JSON.stringify(before[sel]) !== JSON.stringify(after[sel]);
    if (changed) {
      return {
        result: false,
        changedDropdown: sel,
        triggerDropdown: triggerSelector,
      };
    }
  }

  return { result: true };
}
async function get_year_drop_down() {
  return [
    // 109
    "Year",
    "2027",
    "2026",
    "2025",
    "2024",
    "2023",
    "2022",
    "2021",
    "2020",
    "2019",
    "2018",
    "2017",
    "2016",
    "2015",
    "2014",
    "2013",
    "2012",
    "2011",
    "2010",
    "2009",
    "2008",
    "2007",
    "2006",
    "2005",
    "2004",
    "2003",
    "2002",
    "2001",
    "2000",
    "1999",
    "1998",
    "1997",
    "1996",
    "1995",
    "1994",
    "1993",
    "1992",
    "1991",
    "1990",
    "1989",
    "1988",
    "1987",
    "1986",
    "1985",
    "1984",
    "1983",
    "1982",
    "1981",
    "1980",
    "1979",
    "1978",
    "1977",
    "1976",
    "1975",
    "1974",
    "1973",
    "1972",
    "1971",
    "1970",
    "1969",
    "1968",
    "1967",
    "1966",
    "1965",
    "1964",
    "1963",
    "1962",
    "1961",
    "1960",
    "1959",
    "1958",
    "1957",
    "1956",
    "1955",
    "1954",
    "1953",
    "1952",
    "1951",
    "1950",
    "1949",
    "1948",
    "1947",
    "1946",
    "1945",
    "1944",
    "1943",
    "1942",
    "1941",
    "1940",
    "1939",
    "1938",
    "1937",
    "1936",
    "1935",
    "1934",
    "1933",
    "1932",
    "1931",
    "1930",
    "1929",
    "1928",
    "1927",
    "1926",
    "1925",
    "1924",
    "1923",
    "1922",
    "1921",
    "1920",
  ];
}
async function get_related_colors_drop_down() {
  // return ["Related Colors"];
  return [
    //13 "Related Colors",
    "Related Colors",
    "Bumper",
    "Chassis",
    "Door Window",
    "Interior",
    "Multitone",
    "Roof",
    "Stripe",
    "Underhood",
    "Wheel",
    "Door Handle",
    "Grill Radiator",
    "Mirror",
    "Trim",
  ];
}
async function get_color_family_drop_down() {
  return [
    //13
    // "Color Family", "BEIGE", "BLACK", "BLANK", "BLUE", "BROWN", "GREEN", "GREY", "ORANGE", "RED", "VIOLET", "WHITE", "YELLOW"
    "Color Family",
    "BEIGE",
    "BLACK",
    "BLANK",
    "BLUE",
    "BROWN",
    "GREEN",
    "GREY",
    "ORANGE",
    "RED",
    "VIOLET",
    "WHITE",
    "YELLOW",
  ];
}
async function get_solid_effect_drop_down() {
  return [
    //3
    "Solid and Effect",
    "Solid",
    "Effect",
  ];
}
const writeCurrentRowToCsv = async (row) => {
  const csvFilePath = current_filter_csv;
  const header =
    "Make Index,Make,Year Index,Year,Model Index,Model,Related Colors Index,Related Colors,Color Family Index,Color Family,Solid Effect Index,Solid Effect\n";
  const csvContent = header + row;

  try {
    await fs.promises.writeFile(csvFilePath, csvContent);
    console.log("File written successfully");
  } catch (error) {
    console.error("Error writing file:", error);
    throw error; // Re-throw the error if you want calling code to handle it
  }
};
const writeCurrentSearchFiltersParametersToCsv = (filtersObject) => {
  try {
    const csvFilePath = search_filter_param_csv;
    // Convert the object to JSON string
    const jsonString = JSON.stringify(filtersObject, null, 2);
    fs.writeFileSync(csvFilePath, jsonString);
    console.log("✓ Filters written to CSV:", jsonString);
    return true;
  } catch (error) {
    console.error("❌ Error writing filters to CSV:", error);
    return false;
  }
};

const appendCurrentRowToCsv = async (row) => {
  const csvFilePath = all_completed_filter_csv;

  try {
    const fileExists = fs.existsSync(csvFilePath);

    if (!fileExists) {
      const header =
        "Make Index,Make,Year Index,Year,Model Index,Model,Related Colors Index,Related Colors,Color Family Index,Color Family,Solid Effect Index,Solid Effect\n";
      await fs.promises.writeFile(csvFilePath, header);
    }

    await fs.promises.appendFile(csvFilePath, row);
    console.log("Row appended successfully");
  } catch (error) {
    console.error("Error appending to file:", error);
    throw error;
  }
};
const readLastRowFromCsv = (csvFilePath) => {
  if (!fs.existsSync(csvFilePath)) {
    return null; // File doesn't exist
  }

  const data = fs.readFileSync(csvFilePath, "utf8");
  const rows = data.trim().split("\n");

  if (rows.length <= 1) {
    return null; // Only header or empty file
  }

  const lastRow = rows[rows.length - 1]; // Get the last row
  return lastRow.split(","); // Split the row into columns
};
function readJsonRowFromCsv(filePath) {
  try {
    const fs = require("fs");

    // Check if file exists
    if (!fs.existsSync(filePath)) {
      console.log("CSV file does not exist:", filePath);
      return null;
    }

    const data = fs.readFileSync(filePath, "utf8").trim();
    console.log("Raw file content search_filter_param_csv :", data);

    if (!data) {
      console.log("File is empty");
      return null;
    }

    // Try to parse the entire content as JSON
    try {
      const parsedData = JSON.parse(data);
      console.log("✓ Successfully parsed JSON from file");
      return parsedData;
    } catch (parseError) {
      console.error("❌ Error parsing JSON:", parseError.message);

      // If direct parse fails, try to extract JSON from the content
      const jsonMatch = data.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        try {
          const extractedJson = JSON.parse(jsonMatch[0]);
          console.log("✓ Successfully extracted and parsed JSON");
          return extractedJson;
        } catch (extractError) {
          console.error(
            "❌ Error parsing extracted JSON:",
            extractError.message
          );
        }
      }
      return null;
    }
  } catch (error) {
    console.error("❌ Error reading CSV file:", error);
    return null;
  }
}

async function loadFromPage(res) {
  console.log(`step 2 `);

  let make_drop_down = await get_make_drop_down();
  let year_drop_down = await get_year_drop_down();

  let related_colors_drop_down = await get_related_colors_drop_down();
  let color_family_drop_down = await get_color_family_drop_down();
  let solid_effect_drop_down = await get_solid_effect_drop_down();
  let lastRow = readLastRowFromCsv(current_filter_csv);
  let obj_search_filter_param_csv = {
    allowed_years: [],
    allowed_makes: [],
    allowed_models: [],
  };
  try {
    obj_search_filter_param_csv = readJsonRowFromCsv(search_filter_param_csv);

    console.log(
      "Raw obj_search_filter_param_csv row:",
      obj_search_filter_param_csv
    );
  } catch (parseError) {
    console.error("Error parsing JSON from CSV:", parseError);
  }
  let make_drop_down_index = 0; //0
  let year_drop_down_index = 0; //0
  let model_drop_down_index = 0;
  // let model_drop_down_text = "";
  let related_colors_drop_down_index = 0;
  let color_family_drop_down_index = 0;
  let solid_effect_drop_down_index = 0;
  if (lastRow) {
    make_drop_down_index = parseInt(lastRow[0]);
    year_drop_down_index = parseInt(lastRow[2]);
    model_drop_down_index = parseInt(lastRow[4]);
    // model_drop_down_text = lastRow[5];
    related_colors_drop_down_index = parseInt(lastRow[6]);
    color_family_drop_down_index = parseInt(lastRow[8]);
    solid_effect_drop_down_index = parseInt(lastRow[10]);

  } else {
    const all_completed = readLastRowFromCsv(all_completed_filter_csv);
    if (all_completed) {
      make_drop_down_index = parseInt(all_completed[0]);
      year_drop_down_index = parseInt(all_completed[2]);
      model_drop_down_index = parseInt(all_completed[4]);
      // model_drop_down_text = all_completed[5];
      related_colors_drop_down_index = parseInt(all_completed[6]);
      color_family_drop_down_index = parseInt(all_completed[8]);
      solid_effect_drop_down_index = parseInt(all_completed[10]);
    }
  }
  filters_obj = {
    description: null,
    year: year_drop_down_index,
    make: make_drop_down_index,
    model: model_drop_down_index,
    model_text: "",
    plastic_parts: related_colors_drop_down_index,
    groupdesc: color_family_drop_down_index,
    effect: solid_effect_drop_down_index,
  };
  await setSearchFilters(page, null);

  // if (lastRow || all_completed) {
  if (false) {
    let filter_completed = false;
    if (solid_effect_drop_down_index >= solid_effect_drop_down.length - 1) {
      solid_effect_drop_down_index = 0;
      color_family_drop_down_index++;
      filter_completed = true;
    } else {
      solid_effect_drop_down_index++;
    }

    // If we're at the end of color_family_drop_down, reset and increment related_colors_drop_down
    if (
      color_family_drop_down_index >= color_family_drop_down.length - 1 &&
      filter_completed
    ) {
      color_family_drop_down_index = 0;
      related_colors_drop_down_index++;
    }

    // If we're at the end of related_colors_drop_down, reset and increment model_drop_down
    if (
      related_colors_drop_down_index >= related_colors_drop_down.length - 1 &&
      filter_completed
    ) {
      related_colors_drop_down_index = 0;
      model_drop_down_index++;
    }

    if (
      model_drop_down_index >= _models_drop_down.length - 1 &&
      filter_completed
    ) {
      console.log("incementing year_drop_down_index");
      model_drop_down_index = 0;
      year_drop_down_index++;
    }

    // If we're at the end of year_drop_down, reset and increment make_drop_down
    if (year_drop_down_index >= year_drop_down.length - 1 && filter_completed) {
      year_drop_down_index = 0;
      make_drop_down_index++;
    }
  }

  let shouldStop = false; // Flag to control loop termination
  let total_count = 0;
  const retryOptions = {
    maxRetries: 15, // 30 retries
    initialDelay: 1000, // Starting with 1 second delay
    maxDelay: 10 * 60 * 1000, // Up to 10 minutes total wait time
  };
  console.log("before combination in loop :");
  console.log("Processing combination in loop :");
  console.log("make:", make_drop_down_index, "/", make_drop_down.length);
  console.log("year:", year_drop_down_index, "/", year_drop_down.length);
  console.log("model:", model_drop_down_index, "/", _models_drop_down.length);
  // console.log("model model_drop_down_text :", model_drop_down_text, "/", _models_drop_down.length);
  console.log("obj_search_filter_param_csv:", obj_search_filter_param_csv);
  let row;
  for (; make_drop_down_index < make_drop_down.length; make_drop_down_index++) {
    if (obj_search_filter_param_csv?.allowed_makes?.length > 0) {
      if (
        !obj_search_filter_param_csv.allowed_makes.includes(
          make_drop_down[make_drop_down_index]
        )
      ) {
        console.log(
          "in if condition not alowed make_drop_down : ",
          make_drop_down[make_drop_down_index]
        );
        continue;
      } else {
        // console.log(
        //   "else alloed make_drop_down : ",
        //   make_drop_down[make_drop_down_index]
        // );
      }
    }
    for (
      ;
      year_drop_down_index < year_drop_down.length;
      year_drop_down_index++
    ) {
      console.log("year:", year_drop_down_index, "/", year_drop_down.length);
      const currentYear = year_drop_down[year_drop_down_index];
      if (obj_search_filter_param_csv?.allowed_years?.length > 0) {
        const currentYearNumber = Number(currentYear);

        if (
          !obj_search_filter_param_csv.allowed_years.includes(currentYearNumber)
        ) {
          console.log("in if not alloedcondition", currentYear);
          continue;
        }
      }
      
      filters_obj = {
        description: null,
        year: 0,
        make: make_drop_down_index,
        model: null,
        // model_text: model_drop_down_text,
        plastic_parts: null,
        groupdesc: null,
        effect: null,
      };
      await setSearchFilters(page);
      for (
        ;
        model_drop_down_index < _models_drop_down.length;
        model_drop_down_index++
      ) {

        if (obj_search_filter_param_csv?.allowed_models?.length > 0) {
          if (
            !obj_search_filter_param_csv.allowed_models.includes(
              _models_drop_down[model_drop_down_index]
            )
          ) {
            console.log(
              "in if condition not alowed model_drop_down : ",
              _models_drop_down[model_drop_down_index]
            );
            continue;
          } 
          else {
            // console.log(
            //   "else alloed model_drop_down : ",
            //   _models_drop_down[model_drop_down_index]
            // );
          }
        }
        console.log(
          "in start related_colors_drop_down_index : ",
          related_colors_drop_down_index
        );

        for (
          ;
          related_colors_drop_down_index < 1;//related_colors_drop_down.length;
          related_colors_drop_down_index++
        ) {
          console.log(
            "in start color_family_drop_down_index : ",
            color_family_drop_down_index
          );
          for (
            ;
            color_family_drop_down_index < 1;//color_family_drop_down.length;
            color_family_drop_down_index++
          ) {
            console.log(
              "in start solid_effect_drop_down_index : ",
              solid_effect_drop_down_index
            );
            for (
              ;
              solid_effect_drop_down_index < 1;//solid_effect_drop_down.length;
              solid_effect_drop_down_index++
            ) {
              console.log(
                "in betwee solid_effect_drop_down_index : ",
                solid_effect_drop_down_index
              );

              row =
                [
                  make_drop_down_index,
                  make_drop_down[make_drop_down_index],
                  year_drop_down_index,
                  year_drop_down[year_drop_down_index],
                  model_drop_down_index,
                  _models_drop_down[model_drop_down_index],
                  related_colors_drop_down_index,
                  related_colors_drop_down[related_colors_drop_down_index],
                  color_family_drop_down_index,
                  color_family_drop_down[color_family_drop_down_index],
                  solid_effect_drop_down_index,
                  solid_effect_drop_down[solid_effect_drop_down_index],
                ].join(",") + "\n";
              await writeCurrentRowToCsv(row);
              await appendCurrentRowToCsv(row);
              try {
                filters_obj = {
                  description: null,
                  year: year_drop_down_index,
                  make: make_drop_down_index,
                  model: model_drop_down_index,
                  // model_text: model_drop_down_text,
                  plastic_parts: related_colors_drop_down_index,
                  groupdesc: color_family_drop_down_index,
                  effect: solid_effect_drop_down_index,
                };

                await retryWithBackoff(
                  async () => {
                    await scrapDataFromPages();
                    return true;
                  },
                  retryOptions.maxRetries,
                  retryOptions.initialDelay
                );

                total_count++;
              } catch (error) {
                console.error(
                  `Final attempt failed after ${retryOptions.maxRetries} retries:`,
                  error
                );
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
      model_drop_down_index = 0; //0
      // model_drop_down_text = "";//0
      filters_obj = {
        model_text: "",
      };
    }
    if (shouldStop) break; // Exit the make_drop_down loop
    year_drop_down_index = 0; //0
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
    console.error("Page recovery failed:", error);
    return false;
  }
}
async function retryWithBackoff(
  operation,
  maxRetries = 15,
  initialDelay = 1000
) {
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

      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
  throw lastError;
}

async function has_digital_formula(formula_page, selector) {
  let retryCount = 0;
  let MAX_RETRIES = 5;
  let ERROR_MESSAGE =
    "We could not find any formulas. Try to modify your search.";
  while (retryCount < MAX_RETRIES) {
    try {
      let randomWaitTime = getRandomNumber(1500, 2500);
      await formula_page.waitForTimeout(randomWaitTime);
      let errorAlert = await formula_page.$(".alert.alert-danger");
      if (errorAlert) {
        let errorText = await formula_page.evaluate(
          (el) => el.textContent.trim(),
          errorAlert
        );
        if (errorText.includes(ERROR_MESSAGE)) {
          console.log("Error message detected - no formulas found");
          return false;
        }
      }

      await Promise.race([
        formula_page.waitForSelector(selector, { timeout: 10000 }),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error("Timeout")), 10000)
        ),
      ]);
      return true; // Return immediately if found
    } catch (error) {
      retryCount++;
      console.log(
        `Retry ${retryCount}/${MAX_RETRIES} for selector "${selector}"...`
      );
      await loginPage(formula_page);
      // Optional: Add delay between retries
      if (retryCount < MAX_RETRIES) {
        await new Promise((resolve) => setTimeout(resolve, 1000 * retryCount));
      }
    }
  }

  console.log(
    `Selector "${selector}" not found in page after ${MAX_RETRIES} attempts`
  );
  return false;
}

async function scrapDataFromPages() {
  let data_arr = [];
  let descriptionStack = [];
  let hasNextPage = true;
  currentRecursionDepth = 0;
  visitedMultitones.clear();
  await setSearchFilters(page);
  
  console.log('scrapDataFromPages filters : ',filters_obj);
  // return;
  while (hasNextPage) {
    let containers_details = null;
    try {
      // Wait for the selector with a timeout of 10 seconds
      if (!(await has_digital_formula(page, "#digital_formula"))) {
        hasNextPage = false;
        break;
      }

      containers_details = await page.$$eval(
        "#digital_formula > .root",
        (elements, data) => {
          const { filters, models } = data; // destructure the wrapped object

          return elements.map((el) => {
            return {
              familyId: el.getAttribute("family_id"),
              sid: el.getAttribute("sid"),
              make: el.getAttribute("make"),
              model: models?.[filters?.model] ?? "",
              description: el.getAttribute("desc"),
              url: el.getAttribute("url"),
              content: el.innerText.trim(),
            };
          });
        },
        { filters: filters_obj, models: _models_drop_down } // wrap both into one object
      );

      console.log("Found containers:", containers_details.length);

      for (let i = 0; i < containers_details.length; i++) {
        console.log("Processing container", i);
        const container = containers_details[i];

        // Get fresh handles for current container
        const containerHandles = await page.$$("#digital_formula > .root");
        if (i >= containerHandles.length) {
          console.error("Container handle index out of bounds");
          continue;
        }

        const currentHandle = containerHandles[i];
        let hasMultitoneAccess = await currentHandle.$(
          ".formula-multitone-access"
        );
        let extracted_data = {};

        if (hasMultitoneAccess) {
          if (
            visitedMultitones.size < MAX_VISITED_ENTRIES &&
            !visitedMultitones.has(container.description)
          ) {
            console.log("Multitone found in container:", container.description);
            descriptionStack.push({
              description: container.description,
              depth: currentRecursionDepth + 1,
            });
            visitedMultitones.add(container.description);
            console.log("descriptionStack:", descriptionStack);
          }
        } else {
          console.log(
            "Direct data found in container:",
            JSON.stringify(container)
          );
          const buttons = await page.$$(
            '#digital_formula > .root button[data-original-title="Color Information"]'
          );
          extracted_data = await scrapDataFromList(
            page,
            container,
            buttons,
            i,
            data_arr
          );
          console.log("extracted_data here :", extracted_data);
          await saveToExcel(extracted_data, "paint/sheets/paint.csv");
        }
        console.log("Saved container data:", container.description);
      }
      while (descriptionStack.length > 0) {
        const { description, depth } = descriptionStack.pop();
        currentRecursionDepth = depth;

        if (currentRecursionDepth > MAX_RECURSION_DEPTH) {
          console.warn(
            "Maximum recursion depth reached, skipping:",
            description
          );
          continue;
        }

        await setSearchFilters(multitone_page, description);

        let hasNextMultiPage = true;
        while (hasNextMultiPage) {
          // Wait for containers to load in multitone page
          if (
            !(await has_digital_formula(multitone_page, "#digital_formula"))
          ) {
            hasNextMultiPage = false;
            break;
          }

          // Get buttons and containers from multitone page
          const buttons = await multitone_page.$$(
            '#digital_formula > .root button[data-original-title="Color Information"]'
          );
          const multitoneContainers = await multitone_page.$$eval(
            "#digital_formula > .root",
            (elements, data) => {
              const { filters, models } = data;

              return elements.map((el) => {
                const isMultitone =
                  el.querySelector(".formula-multitone-access") !== null;

                return {
                  familyId: el.getAttribute("family_id"),
                  sid: el.getAttribute("sid"),
                  make: el.getAttribute("make"),
                  model: models?.[filters?.model] ?? "",
                  description: el.getAttribute("desc"),
                  url: el.getAttribute("url"),
                  content: el.innerText.trim(),
                  isMultitone: isMultitone,
                };
              });
            },
            { filters: filters_obj, models: _models_drop_down } // ✅ wrap into single object
          );

          // Process each container in multitone page
          for (let j = 0; j < multitoneContainers.length; j++) {
            const mtContainer = multitoneContainers[j];
            let currentPageNumber = await getCurrentPageNumber(page); // Implement this function

            // Save to text file
            const stateData = `Current Page: ${currentPageNumber}\nFilters: ${JSON.stringify(
              filters_obj
            )}\n`;
            const multitoneFile = "multitone_filter.txt";
            if (mtContainer.isMultitone) {
              descriptionStack.push({
                description: mtContainer.description,
                depth: currentRecursionDepth + 1,
              });
              visitedMultitones.add(mtContainer.description);
              console.log("found one more multitone");
              console.log(multitoneFile, stateData);
            } else {
              console.log("found direct data in  multitone");
              // continue;
              extracted_data = await scrapDataFromList(
                multitone_page,
                mtContainer,
                buttons,
                j,
                data_arr
              );
              // await fs.promises.writeFile(multitoneFile, stateData);

              await saveToExcel(extracted_data, "paint/sheets/paint.csv");
            }
          }

          hasNextMultiPage = await goToNextPage(multitone_page);
        }
      }

      hasNextPage = await goToNextPage(page);
    } catch (error) {
      if (error.message === "Timeout") {
        console.log("Timeout: #digital_formula not found within 10 seconds");
        break;
      } else {
        console.error("Error in setSearchFilters:", error);
        break;
      }
    }
  }
}
function parsePaintInfo(content) {
  if (!content) return null;

  // split by newlines, trim empty lines
  const lines = content
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);

  // first line always has brand + maybe code
  const firstLine = lines[0];

  // regex to grab last number block in the first line
  const codeMatch = firstLine.match(/\d+$/);
  // let colorCode = codeMatch ? codeMatch[0] : "";
  let colorCode = "" + ((firstLine ?? "").split(" ")[1] ?? ""); // add ' if required

  if (!colorCode && lines[1]) {
    colorCode = lines[1];
  }

  return {
    code: colorCode,
    colorName: lines[1] || null,
    years: lines[2] || null,
    brand: firstLine.replace(/\d+$/, "").trim(),
  };
}

async function scrapDataFromList(listpage, container, buttons, i, data_arr) {
  let combinedData = {};
  let detailColorUrl = "";
  try {
    buttons = await listpage.$$(
      '#digital_formula > .root button[data-original-title="Color Information"]'
    );

    if (buttons[i]) {
      console.log(`Processing container ${i}`);
      await buttons[i].scrollIntoViewIfNeeded();
      const onclickValue = await buttons[i].evaluate((button) =>
        button.getAttribute("onclick")
      );

      const urlAndIdMatch = onclickValue.match(
        /formulaInfo\(event,'([^']+)','([^']+)'\)/
      );
      if (urlAndIdMatch && urlAndIdMatch[1] && urlAndIdMatch[2]) {
        const url = urlAndIdMatch[1];
        const id = urlAndIdMatch[2];
        let scrap_details = await scrapFormaulaDetailsData(container);
        for (const scrap_detail of scrap_details) {
          combinedData = { ...container, ...scrap_detail };
          data_arr.push(combinedData);
        }
        infoColorUrl = `https://generalpaint.info/v2/search/formula-info?id=${id}`;
        detailColorUrl = `https://generalpaint.info/v2/search/family?id=${container.familyId}&sid=${container.sid}`;
        console.log("detailColorUrl:", detailColorUrl);
        console.log("multiple colors data_arr:", data_arr);

        // await scrapColorInfoData(id);
        // infoColorUrl = 'https://generalpaint.info/v2/search/formula-info?id=107573';
        // detailColorUrl = 'https://generalpaint.info/v2/search/family?id=67746&sid=67d00e248ae305.41320823';
      } else {
        console.error("Failed to extract URL and ID from onclick value");
      }
    }
  } catch (error) {
    console.error("Error scrapDataFromList:", error);
    console.error("url :", detailColorUrl);
  } finally {
    // return combinedData;
    return data_arr;
  }
}
const escapeCsvValue = (value) => {
  if (value == null) return "";
  let str = String(value)
    .replace(/\n/g, " ")
    .replace(/<br>/g, " ")
    .replace(/\t/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  // Escape quotes by doubling them
  if (str.includes('"')) {
    str = str.replace(/"/g, '""');
  }

  // Wrap in quotes if contains comma, quote, or newline
  if (/[",\n]/.test(str)) {
    str = `"${str}"`;
  }

  return str;
};

async function saveToExcel(dataArray, fileName = "paint/sheets/paint.csv") {
  const makeDropdown = await get_make_drop_down();
  const filePath = "paint/sheets/";
  fs.mkdirSync(path.join("paint", "sheets"), { recursive: true });
  fileName = outputFilePath;
  console.log("excel 4");

  // Process each row to upload images and get updated image paths
  const processedDataArray = [];

  for (const row of dataArray) {
    let updatedRow = { ...row };

    // If there's an image path and it's a local file, upload it
    if (row.image_path && fs.existsSync(row.image_path)) {
      console.log(`Uploading image: ${row.image_path}`);

      const uploadResult = await uploadSingle(row);

      if (uploadResult.success && uploadResult.imageSrc) {
        // Update the image_path with the uploaded image URL
        updatedRow.image_path = uploadResult.imageSrc;
        console.log(`✓ Image uploaded successfully: ${uploadResult.imageSrc}`);
      } else {
        console.error(
          `❌ Failed to upload image: ${row.image_path}`,
          uploadResult.error
        );
        // Keep the original image_path if upload fails, or set to empty
        // updatedRow.image_path = ''; // Uncomment if you want to clear failed uploads
      }
    }

    processedDataArray.push(updatedRow);
  }

  const cleanedDataArray = processedDataArray.map((row) => {
    const cleanedRow = {};
    for (const key in row) {
      if (row.hasOwnProperty(key)) {
        cleanedRow[key] = escapeCsvValue(row[key]);
      }
    }
    return cleanedRow;
  });

  const csvData = cleanedDataArray
    .map((row) => {
      return Object.values(row).join(",");
    })
    .join("\n");

  console.log("append file row data", csvData);

  if (fs.existsSync(fileName)) {
    fs.appendFileSync(fileName, `\n${csvData}`);
    write_response.write(
      `data: ${JSON.stringify({
        type: "new_rows",
        rows: processedDataArray,
      })}\n\n`
    );
    // write_response.write(`data:{row: ${csvData}}\n\n`);
  } else {
    const header = Object.keys(cleanedDataArray[0]).join(",");
    // fs.writeFileSync(fileName, `${header}\n${csvData}`);
  }

  console.log(
    `✓ CSV saved with ${processedDataArray.length} rows (including uploaded images)`
  );
}

app.get("/general_paint", async (req, res) => {
  try {
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders();
    write_response = res;
    console.time("Execution Time");
    req.on("close", () => {
      console.log("Client disconnected.");
      isStopped = true; // Set flag to stop scraping
      // browser.close();
    });

    isStopped = false;
    console.log(`step 1 `);
    res.write(`data: [loggingIn]\n\n`);

    await loadFromPage(res);

    res.write(`data: [DONE]\n\n`);
    console.timeEnd("Execution Time");
    res.end();
  } catch (error) {
    console.error(`Error in /general_paint route: ${error.message}`);
    res.write(`data: [ERROR]\n\n`);
    res.end();
  }
});

app.get("/stop_scraping", (req, res) => {
  isStopped = true; // Set flag to stop scraping
  // browser.close();
  res.send({ message: "Scraping stopped" });
  res.end();
});

// app.listen(PORT, () => {
app.listen(PORT, "0.0.0.0", () => {
  console.log(`Server is working `);
  // console.log(`Server is working / running on http://localhost:${PORT}`);
});
