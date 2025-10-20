let eventSource;
let isStopped = false;
let db;
let table_data = [];
let totalRecords = 0;
let uniqueRecords = 0;
let duplicateRecords = 0;
let db_store;

$(function(){
    setTimeout(() => {
        $('#loadButton').click();
    }, 10000);
})

function clear_previous_record() {
    db_store.clear().onsuccess = () => {
        console.log("Previous IndexedDB data cleared.");
        resolve();
    };
}

function initializeIndexedDB() {
    return new Promise((resolve, reject) => {
        const dbRequest = indexedDB.open("UniqueRecordsDB", 1);

        dbRequest.onupgradeneeded = (event) => {
            db = event.target.result;
            if (!db.objectStoreNames.contains("records")) {
                db.createObjectStore("records", { keyPath: "uniqueKey" });
            }
        };

        dbRequest.onsuccess = (event) => {
            db = event.target.result;
            const transaction = db.transaction("records", "readwrite");
            db_store = transaction.objectStore("records");

            // store.clear().onsuccess = () => {
            //     console.log("Previous IndexedDB data cleared.");
            //     resolve();
            // };

            transaction.onerror = (error) => {
                console.error("Error clearing IndexedDB:", error);
                reject(error);
            };
        };

        dbRequest.onerror = (event) => {
            console.error("Error initializing IndexedDB:", event.target.error);
            reject(event.target.error);
        };
    });
}

function addRecordToIndexedDB(records_arr, onSuccess, onDuplicate) {
    if (!db) {
        console.error("IndexedDB is not initialized!");
        return;
    }
    const transaction = db.transaction("records", "readwrite");
    const store = transaction.objectStore("records");

    records_arr.forEach(record => {
        const getRequest = store.get(record.uniqueKey);
        totalRecords++;
        getRequest.onsuccess = () => {
            if (!getRequest.result) {
                const addRequest = store.add(record);
                addRequest.onsuccess = onSuccess;
                uniqueRecords++;
            } else {
                // onDuplicate();
                duplicateRecords++;
            }
            // updateRecordNumbers(totalRecords, uniqueRecords, duplicateRecords);
        };
        updateRecordNumbers(totalRecords, uniqueRecords, duplicateRecords);


        getRequest.onerror = () => {
            console.error("Error accessing IndexedDB.");
        };
    });

}
function updateRecordNumbers(totalRecords, uniqueRecords, duplicateRecords) {
    $('#total').text(totalRecords);
    $('#unique').text(uniqueRecords);
    $('#duplicate').text(duplicateRecords);
}
document.getElementById("startButton").addEventListener("click", () => {
    // $("#startButton").css("display", "none");
    $("#stopButton").css("display", "block");
    $("#downloadCsvButton").css("display", "none");

    const tableBody = document.querySelector("#dataTable tbody");
    initializeIndexedDB();
    // Prevent starting if already running
    if (eventSource && !isStopped) return;

    console.log("Starting data fetch...");
    isStopped = false;
    tableBody.innerHTML = "";
    let start_page = $('#start_page').val();

    // Replace with your actual API endpoint
    eventSource = new EventSource(`http://localhost:5005/general_paint?start_page=${start_page}`);

    console.log('event', eventSource);
    eventSource.onmessage = (event) => {
        console.log('event.data onmessage function', event.data);
        if (event.data === "[loggingIn]") {
            showLoadingModal("Scrapper Started");
            return;
        }

        if (event.data === "[DONE]") {
            eventSource.close();
            $("#stopButton").click();
            return;
        }

        if (event.data === "[ERROR]") {
            showServerError();
            eventSource.close();
            $("#stopButton").click();
            return;
        }

        hideLoadingModal();
        const response = JSON.parse(event.data);
        const page_num = response.page_num ?? '';
        const rowsData = response.data;
        if (!isNaN(page_num)) {
            $('#pages_scraped').text(page_num);
        }
        addRecordToIndexedDB(
            rowsData,
            () => {
                addRowsToTable(rowsData, tableBody);
                showToast(`${rowsData.length} Rows added successfully`);
            },
            () => {
                showErrorToast(`Duplicate data found`);
            }
        );
    };

    eventSource.onerror = (error) => {
        showErrorToast(`Browser isn't responding please close captch its closed and try agin from page number ${rowsData.page_num}.`);
        console.error("Error receiving data:", error);
        showServerError();
        eventSource.close();
    };
});

function showLoadingModal(message) {
    $("#loadingMessage").text(message);
    const loadingModal = new bootstrap.Modal(document.getElementById("loadingModal"));
    loadingModal.show();
}

function hideLoadingModal() {
    $("#closeLoadingbtn").click();
}

function showServerError() {
    $(".server_error").css("display", "block");
}

function addRowsToTable(rowsData, tableBody) {
    tableBody.innerHTML = "";
    rowsData.forEach(rowData => {
        const newRow = document.createElement("tr");
        newRow.innerHTML = `
        <td>${rowData.name}</td>
        <td>${rowData.email}</td>
        <td>${rowData.phone}</td>
        <td>${rowData.address}</td>`;
        tableBody.appendChild(newRow);
    });
}

function showToast(message) {
    document.getElementById("toastContent").innerText = message;
    const infoToast = new bootstrap.Toast(document.getElementById("infoToast"));
    infoToast.show();
}

function showErrorToast(message) {
    document.getElementById("errorToastContent").innerText = message;
    const errorToast = new bootstrap.Toast(document.getElementById("errorToast"));
    errorToast.show();
}

window.addEventListener("beforeunload", () => {
    if (eventSource) {
        eventSource.close();
    }
});

document.getElementById('loadButton').addEventListener('click', async () => {
    $("#loadButton").css('display', 'none');
    $("#startButton").css('display', 'block');
    $("#stopButton").css('display', 'none');
    $("#downloadCsvButton").css('display', 'none');
    // await fetch('http://localhost:5005/loadurl', { method: 'GET' });

    
    const es = new EventSource("http://localhost:5005/loadurl");

    es.onmessage = (event) => {
        console.log("SSE:", event.data);

        if (event.data === "[loadurlSuccess]") {
            es.close();                       // close SSE connection
            $("#startButton").show().trigger("click"); // show + auto-click
        }

        if (event.data.startsWith("[ERROR")) {
            es.close();
            alert("Error loading URL: " + event.data);
        }
    };
    console.log("Open browser.");
});

document.getElementById('stopButton').addEventListener('click', async () => {
    $("#startButton").css('display', 'none');
    $("#stopButton").css('display', 'none');
    // $("#downloadCsvButton").css('display', 'block');

    if (eventSource) {
        isStopped = true;
        eventSource.close();
        eventSource = null;
        await fetch('http://localhost:5005/stop_scraping', { method: 'GET' });
        console.log("Scraping stopped by the user.");
    }
});

function getAllRecords() {
    // const transaction = db.transaction("records", "readwrite");
    // const store = transaction.objectStore("records");
    return new Promise((resolve, reject) => {
    //   const transaction = db.transaction(storeName, "readonly");
    //   const store = transaction.objectStore(storeName);
      const request = db_store.getAll();

      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  function convertToCSV(data) {
    if (!data.length) return "";

    // Extract headers (keys of the first object)
    const headers = Object.keys(data[0]);
    const csvRows = [headers.join(",")]; // Add headers as the first row

    // Add data rows
    data.forEach((record) => {
      const row = headers.map((header) => {
        const value = record[header];
        // Escape quotes in values
        return `"${String(value || "").replace(/"/g, '""')}"`;
      });
      csvRows.push(row.join(","));
    });

    return csvRows.join("\n");
  }

  // Trigger download of CSV data
  function downloadCSV(csvData) {
    const blob = new Blob([csvData], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const link = $("<a>")
      .attr("href", url)
      .attr("download", "data.csv")
      .appendTo("body");
    link[0].click();
    link.remove();
    URL.revokeObjectURL(url);
  }

  // Handle button click to download CSV
  $("#download").on("click", async () => {

  });

  async function downloadData(event){
    try {
    event.preventDefault();

        // const db = await openDatabase();
        const records = await getAllRecords();
  
        // Convert records to CSV and download
        const csvData = convertToCSV(records);
        if (csvData) {
          downloadCSV(csvData);
        } else {
          alert("No data to download!");
        }
      } catch (error) {
        console.error("Error downloading CSV:", error);
      }
  }

