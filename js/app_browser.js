    let eventSource;
        let isStopped = false;
        let totalRecords = 0;
        let uniqueRecords = 0;
        let duplicateRecords = 0;
        let pagesScraped = 0;

        // Initialize event listeners
        $(document).ready(function() {
            console.log("Initializing General Paint Scraper...");
            
            // File path selector change handler
            $('#outputFilePath').change(function() {
                if ($(this).val() === 'custom') {
                    $('#customFilePath').show().focus();
                } else {
                    $('#customFilePath').hide();
                }
            });
            
            // Add event listeners for filter checkboxes
            $('#enableMake').change(function() {
                $('#make').toggle(this.checked).focus();
                if (this.checked) {
                    $('#make').addClass('border-primary');
                } else {
                    $('#make').removeClass('border-primary');
                }
            });
            
            $('#enableYear').change(function() {
                $('#year').toggle(this.checked).focus();
                if (this.checked) {
                    $('#year').addClass('border-primary');
                    validateYearInput();
                } else {
                    $('#year').removeClass('border-primary');
                    $('#yearValidation').hide();
                }
            });
            
            $('#enableModel').change(function() {
                $('#model').toggle(this.checked).focus();
                if (this.checked) {
                    $('#model').addClass('border-primary');
                } else {
                    $('#model').removeClass('border-primary');
                }
            });
            
            $('#enableRelatedColors').change(function() {
                $('#related_colors').toggle(this.checked).focus();
                if (this.checked) {
                    $('#related_colors').addClass('border-primary');
                } else {
                    $('#related_colors').removeClass('border-primary');
                }
            });
            
            $('#enableColorFamily').change(function() {
                $('#color_family').toggle(this.checked).focus();
                if (this.checked) {
                    $('#color_family').addClass('border-primary');
                } else {
                    $('#color_family').removeClass('border-primary');
                }
            });
            
            $('#enableSolidEffect').change(function() {
                $('#solid_effect').toggle(this.checked).focus();
                if (this.checked) {
                    $('#solid_effect').addClass('border-primary');
                } else {
                    $('#solid_effect').removeClass('border-primary');
                }
            });

            // Year input validation
            $('#year').on('input', function() {
                validateYearInput();
            });

            // Set default file path
            $('#outputFilePath').val('paint/sheets/paint_data.csv');
            
            // Initialize year validation
            if ($('#enableYear').is(':checked')) {
                validateYearInput();
            }
        });

        // Year validation function
        function validateYearInput() {
            const yearInput = $('#year');
            const validationMessage = $('#yearValidation');
            const value = yearInput.val().trim();
            
            if (value === '') {
                validationMessage.hide();
                yearInput.removeClass('is-valid is-invalid');
                return false;
            }
            
            // Check for single year
            if (/^\d{4}$/.test(value)) {
                const year = parseInt(value);
                if (year >= 1000 && year <= 9999) {
                    validationMessage.text('✓ Valid year').removeClass('text-danger').addClass('text-success').show();
                    yearInput.removeClass('is-invalid').addClass('is-valid');
                    return true;
                } else {
                    validationMessage.text('Please enter a valid 4-digit year (1000-9999)').removeClass('text-success').addClass('text-danger').show();
                    yearInput.removeClass('is-valid').addClass('is-invalid');
                    return false;
                }
            }
            
            // Check for year range
            if (/^\d{4}-\d{4}$/.test(value)) {
                const years = value.split('-');
                const startYear = parseInt(years[0]);
                const endYear = parseInt(years[1]);
                
                if (startYear >= 1000 && startYear <= 9999 && 
                    endYear >= 1000 && endYear <= 9999 &&
                    startYear <= endYear) {
                    validationMessage.text('✓ Valid year range').removeClass('text-danger').addClass('text-success').show();
                    yearInput.removeClass('is-invalid').addClass('is-valid');
                    return true;
                } else {
                    validationMessage.text('Please enter a valid year range (start year ≤ end year, both 4-digit)').removeClass('text-success').addClass('text-danger').show();
                    yearInput.removeClass('is-valid').addClass('is-invalid');
                    return false;
                }
            }
            
            validationMessage.text('Please enter a valid year (e.g., 2024) or year range (e.g., 2020-2024)').removeClass('text-success').addClass('text-danger').show();
            yearInput.removeClass('is-valid').addClass('is-invalid');
            return false;
        }

        function clear_previous_record() {
            console.log("Clear previous record function called");
            // Reset counters
            totalRecords = 0;
            uniqueRecords = 0;
            duplicateRecords = 0;
            pagesScraped = 0;
            updateRecordNumbers();
            showToast("Previous data cleared successfully");
        }

        function updateRecordNumbers(total = totalRecords, unique = uniqueRecords, duplicate = duplicateRecords) {
            $('#total').text(total);
            $('#unique').text(unique);
            $('#duplicate').text(duplicate);
            $('#pages_scraped').text(pagesScraped);
        }

        function addRecordToTable(records_arr) {
            records_arr.forEach(record => {
                totalRecords++;
                uniqueRecords++;
            });
            
            addRowsToTable(records_arr, document.querySelector("#dataTable tbody"));
            updateRecordNumbers();
            showToast(`✓ ${records_arr.length} records added successfully`);
        }

        function getOutputFilePath() {
            return $('#customFilePath').val().trim();
            const selectedPath = $('#outputFilePath').val();
            if (selectedPath === 'custom') {
                return $('#customFilePath').val().trim();
            }
            return selectedPath;
        }

        function validateForm() {
            const outputFilePath = $('#customFilePath').val().trim();
            
            if (!outputFilePath) {
                showErrorToast("Please select or enter an output file path");
                $('#customFilePath').focus();
                return false;
            }
            
            // Validate file path format
            if (!outputFilePath.endsWith('.csv')) {
                showErrorToast("Output file path must end with .csv");
                $('#customFilePath').focus();
                return false;
            }
            
            // Validate year input if enabled
            if ($('#enableYear').is(':checked') && !validateYearInput()) {
                showErrorToast("Please enter a valid year or year range");
                $('#year').focus();
                return false;
            }
            
            return true;
        }

        document.getElementById("startButton").addEventListener("click", () => {
            if (!validateForm()) {
                return;
            }

            $("#stopButton").css("display", "inline-block");
            $("#startButton").css("display", "none");
            $("#clear_previous_data").css("display", "inline-block");

            const tableBody = document.querySelector("#dataTable tbody");
            
            // Prevent starting if already running
            if (eventSource && !isStopped) return;

            console.log("Starting data fetch...");
            isStopped = false;
            
            // Show table and hide no data message
            $("#dataTable").css("display", "table");
            $("#noDataMessage").css("display", "none");
            $(".record-info").css("display", "block");

            let start_page = $('#start_page').val();

            // Build query parameters with filters
            let queryParams = `start_page=${start_page}`;
            
            // Add output file path
            const outputFilePath = getOutputFilePath();
            queryParams += `&outputFilePath=${encodeURIComponent(outputFilePath)}`;
            
            // Add optional filters if enabled
            if ($('#enableMake').is(':checked')) {
                queryParams += `&make=${encodeURIComponent($('#make').val())}`;
            }
            if ($('#enableYear').is(':checked')) {
                queryParams += `&year=${encodeURIComponent($('#year').val())}`;
            }
            if ($('#enableModel').is(':checked')) {
                queryParams += `&model=${encodeURIComponent($('#model').val())}`;
            }
            if ($('#enableRelatedColors').is(':checked')) {
                queryParams += `&related_colors=${encodeURIComponent($('#related_colors').val())}`;
            }
            if ($('#enableColorFamily').is(':checked')) {
                queryParams += `&color_family=${encodeURIComponent($('#color_family').val())}`;
            }
            if ($('#enableSolidEffect').is(':checked')) {
                queryParams += `&solid_effect=${encodeURIComponent($('#solid_effect').val())}`;
            }

            // Replace with your actual API endpoint
            eventSource = new EventSource(`http://localhost:5005/general_paint?${queryParams}`);

            console.log('Starting EventSource with params:', queryParams);
            
            eventSource.onmessage = (event) => {
                console.log('Event data:', event.data);
                
                if (event.data === "[loggingIn]") {
                    showLoadingModal("Scraper Started - Loading data...");
                    return;
                }

                if (event.data === "[DONE]") {
                    eventSource.close();
                    $("#stopButton").click();
                    showToast("✅ Data extraction completed successfully!");
                    return;
                }

                if (event.data === "[ERROR]") {
                    showServerError();
                    eventSource.close();
                    $("#stopButton").click();
                    return;
                }

                hideLoadingModal();
                
                try {
                    const response = JSON.parse(event.data);
                    const page_num = response.page_num ?? '';
                    const rowsData = response.rows ?? [];
                    if(response.type === "new_rows" && rowsData.length > 0){          
                        if (!isNaN(page_num)) {
                            pagesScraped = page_num;
                            $('#pages_scraped').text(pagesScraped);
                        }
                        
                        if (rowsData && rowsData.length > 0) {
                            addRecordToTable(rowsData);
                        }
                    }
                    
                } catch (error) {
                    console.error("Error parsing event data:", error);
                }
            };

            eventSource.onerror = (error) => {
                showErrorToast(`❌ Browser isn't responding. Please check if any captcha needs to be solved and try again.`);
                console.error("Error receiving data:", error);
                showServerError();
                if (eventSource) {
                    eventSource.close();
                }
            };
        });

        function showLoadingModal(message) {
            $("#loadingMessage").text(message);
            const loadingModal = new bootstrap.Modal(document.getElementById("loadingModal"));
            loadingModal.show();
        }

        function hideLoadingModal() {
            const loadingModal = bootstrap.Modal.getInstance(document.getElementById("loadingModal"));
            if (loadingModal) {
                loadingModal.hide();
            }
        }

        function showServerError() {
            $(".server_error").css("display", "block");
        }

        function addRowsToTable(rowsData, tableBody) {
            // Prepend new rows (add at beginning)
            rowsData.reverse().forEach(rowData => { // Reverse to maintain order when prepending
                const newRow = document.createElement("tr");
                newRow.innerHTML = `
                    <td>${rowData.familyId || ''}</td>
                    <td>${rowData.sid || ''}</td>
                    <td>${rowData.make || ''}</td>
                    <td>${rowData.model || ''}</td>
                    <td>${rowData.description || ''}</td>
                    <td>${rowData.url || ''}</td>
                    <td>${rowData.content || ''}</td>
                    <td>${rowData.year || ''}</td>
                    <td>${rowData.color || ''}</td>
                    <td>${rowData.colorCode || ''}</td>
                    <td>${rowData.tone || ''}</td>
                    <td>${rowData.panelNo || ''}</td>
                    <td>${rowData.details || ''}</td>
                    <td>${rowData.image_path ? `<img src="${rowData.image_path}" alt="Color" style="max-width: 50px; max-height: 50px;">` : ''}</td>`;
                    // <td style="background-color: ${rowData.bgColor || 'transparent'}">${rowData.bgColor || ''}</td>
                
                // Prepend the new row (add at top)
                tableBody.insertBefore(newRow, tableBody.firstChild);
            });

            // Remove excess rows if more than 50
            const allRows = tableBody.querySelectorAll('tr');
            if (allRows.length > 25) {
                for (let i = 25; i < allRows.length; i++) {
                    tableBody.removeChild(allRows[i]);
                }
            }
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
            if (!validateForm()) {
                return;
            }

            // Show loading state
            $("#loadButton").prop('disabled', true).html('⏳ Loading...');
            
            // Build query parameters with filters for loadurl
            let queryParams = '';
            
            // Add output file path
            const outputFilePath = getOutputFilePath();
            queryParams += `outputFilePath=${encodeURIComponent(outputFilePath)}`;
            
            // Add optional filters if enabled
            if ($('#enableMake').is(':checked')) {
                queryParams += `&make=${encodeURIComponent($('#make').val())}`;
            }
            if ($('#enableYear').is(':checked')) {
                queryParams += `&year=${encodeURIComponent($('#year').val())}`;
            }
            if ($('#enableModel').is(':checked')) {
                queryParams += `&model=${encodeURIComponent($('#model').val())}`;
            }
            if ($('#enableRelatedColors').is(':checked')) {
                queryParams += `&related_colors=${encodeURIComponent($('#related_colors').val())}`;
            }
            if ($('#enableColorFamily').is(':checked')) {
                queryParams += `&color_family=${encodeURIComponent($('#color_family').val())}`;
            }
            if ($('#enableSolidEffect').is(':checked')) {
                queryParams += `&solid_effect=${encodeURIComponent($('#solid_effect').val())}`;
            }

            showLoadingModal("Opening browser and loading URL...");

            try {
                const es = new EventSource(`http://localhost:5005/loadurl?${queryParams}`);

                es.onmessage = (event) => {
                    console.log("SSE:", event.data);

                    if (event.data === "[loadurlSuccess]") {
                        es.close();
                        hideLoadingModal();
                        $("#loadButton").css('display', 'none');
                        $("#startButton").css('display', 'inline-block');
                        showToast("✅ Browser opened successfully! Ready to start search.");
                    }

                    if (event.data.startsWith("[ERROR")) {
                        es.close();
                        hideLoadingModal();
                        $("#loadButton").prop('disabled', false).html('🚀 Open Browser & Load URL');
                        showErrorToast("❌ Error loading URL: " + event.data);
                    }
                };
                
                es.onerror = (error) => {
                    console.error("Error in loadurl:", error);
                    es.close();
                    hideLoadingModal();
                    $("#loadButton").prop('disabled', false).html('🚀 Open Browser & Load URL');
                    showErrorToast("❌ Error connecting to server");
                };
                
            } catch (error) {
                console.error("Error starting loadurl:", error);
                hideLoadingModal();
                $("#loadButton").prop('disabled', false).html('🚀 Open Browser & Load URL');
                showErrorToast("❌ Failed to start browser session");
            }
        });

        document.getElementById('stopButton').addEventListener('click', async () => {
            $("#startButton").css('display', 'inline-block');
            $("#stopButton").css('display', 'none');

            if (eventSource) {
                isStopped = true;
                eventSource.close();
                eventSource = null;
                try {
                    await fetch('http://localhost:5005/stop_scraping', { method: 'GET' });
                    showToast("⏹ Search stopped successfully");
                } catch (error) {
                    console.error("Error stopping scraping:", error);
                }
                console.log("Scraping stopped by the user.");
            }
        });