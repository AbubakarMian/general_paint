let eventSource;
let isStopped = false;
let uniqueRecords = new Set();
let table_data = [];



window.addEventListener("beforeunload", () => {
    if (eventSource) {
        eventSource.close();
    }
});

document.getElementById('startButton').addEventListener('click', () => {
    const url = document.getElementById("urlInput").value;

    if (url == '') {
        return;
    }

    $("#startButton").css('display', 'none');
    $("#stopButton").css('display', 'block');
    $("#downloadCsvButton").css('display', 'none');

    const tableBody = document.querySelector("#dataTable tbody");

    if (eventSource && !isStopped) return; // Prevent starting if already running
    console.log('starting 1');
    isStopped = false;
    // tableBody.innerHTML = ''; 
    // eventSource = new EventSource(`https://node.hatinco.com/demand_base?url=${encodeURIComponent(url)}`);
    eventSource = new EventSource(`http://localhost:5003/demand_base?url=${encodeURIComponent(url)}`);
    eventSource.onmessage = (event) => {

        if (event.data === "[loggingIn]") {
            const loadingModal = new bootstrap.Modal(document.getElementById('loadingModal'));
            // $('#loadingStatus').html('Loading loggin In ...');
            $('#loadingMessage').text('Signing In...');
            loadingModal.toggle();
            return;
        }
        if (event.data === "[loadingURL]") {
            $('#loadingMessage').text('Loading URL...');

            // $('#loadingStatus').html('Loading URL ...');
            return;
        }
        if (event.data === "[DONE]") {
            eventSource.close();
            $('#stopButton').click();
            return;
        }
        // $('#loadingStatus').html('');

        $('#closeLoadingbtn').click();

        const rowData = JSON.parse(event.data);
        const toastContent = `Added: Name: ${rowData.name},  Email: ${rowData.email},phone: ${rowData.phone},address: ${rowData.address}`;
        let uniqueKey = rowData.uniqueKey;
        console.log('starting 2', uniqueKey);

        if (!uniqueRecords.has(uniqueKey)) {
            uniqueRecords.add(uniqueKey);
            table_data = {
                name: rowData.name, email: rowData.email,
                phone: rowData.phone, address: rowData.address
            };
            const newRow = document.createElement("tr");
            newRow.innerHTML = `
                    <td>${rowData.name}</td>
                    <td>${rowData.email}</td>
                    <td>${rowData.phone}</td>
                    <td>${rowData.address}</td>`;
            tableBody.appendChild(newRow);
            document.getElementById('toastContent').innerText = toastContent;

            const infoToast = new bootstrap.Toast(document.getElementById('infoToast'));
            infoToast.show();
        }
        else {
            console.log('else starting 3');

            const errorContent = `Duplicate entry : ${toastContent}`;
            document.getElementById('errorToastContent').innerText = errorContent;
            const errorToast = new bootstrap.Toast(document.getElementById('errorToast'));
            errorToast.show();
        }
    };

    eventSource.onerror = (error) => {
        console.error("Error receiving data:", error);
        eventSource.close();
    };
});


document.getElementById('stopButton').addEventListener('click', async () => {
    $("#startButton").css('display', 'block');
    $("#stopButton").css('display', 'none');
    $("#downloadCsvButton").css('display', 'block');

    if (eventSource) {
        isStopped = true;
        eventSource.close();
        eventSource = null;
        await fetch('http://localhost:5003/stop_scraping', { method: 'GET' });
        console.log("Scraping stopped by the user.");
    }
});

document.getElementById('downloadCsvButton').addEventListener('click', (event) => {
    $("#stopButton").click();
    event.preventDefault();
    const table = document.querySelector("#dataTable");
    const rows = table.querySelectorAll('tr');
    const csvData = [];

    // Loop through all rows and cells to extract data
    rows.forEach((row, index) => {
        const rowData = [];
        const cells = row.querySelectorAll('td, th');

        cells.forEach(cell => {
            let cellText = cell.innerText.trim();

            // Escape double quotes by doubling them
            if (cellText.includes('"')) {
                cellText = cellText.replace(/"/g, '""');
            }

            // Enclose the cell value in double quotes if it contains a comma, a quote, or a newline
            if (cellText.includes(',') || cellText.includes('"') || cellText.includes('\n')) {
                cellText = `"${cellText}"`;
            }

            rowData.push(cellText);
        });

        if (rowData.length > 0) {
            csvData.push(rowData.join(','));
        }
    });

    // Create a CSV string
    const csvString = csvData.join('\n');

    // Create a Blob with the CSV data and trigger a download
    const blob = new Blob([csvString], { type: 'text/csv' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = 'data.csv';
    link.click();
});