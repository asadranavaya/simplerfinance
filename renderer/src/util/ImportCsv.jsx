import { useState } from "react";
import Papa from "papaparse";
//import worker from "pdfjs-dist/build/pdf.worker.mjs?url";

const ImportModal = ({ showImportModal, setShowImportModal, creditCards, handleImport }) => {
    const [headers, setHeaders] = useState([]);
    const [amountColumn, setAmountColumn] = useState("");
    const [descriptionColumn, setDescriptionColumn] = useState("");
    const [dateColumn, setDateColumn] = useState("");
    const [csvData, setCsvData] = useState(null);
    const [isDragOver, setIsDragOver] = useState(false);
    const [selectedCardId, setSelectedCardId] = useState("");
    const [discardNegatives, setDiscardNegatives] = useState(true);
    const [addMultipleMonths, setAddMultipleMonths] = useState(true);
    const [showWarning, setShowWarning] = useState(false);

    const resetModal = () => {
        setHeaders([]);
        setAmountColumn("");
        setDescriptionColumn("");
        setDateColumn("");
        setCsvData(null);
        setSelectedCardId("");
        setIsDragOver(false);
        setAddMultipleMonths(true);
        setDiscardNegatives(true);
        setShowWarning(false);
    };

    //GlobalWorkerOptions.workerSrc = worker;

    const handleFile = async (file) => {
        const fileExt = file.name.split('.').pop().toLowerCase();

        if (fileExt === "csv") {
            Papa.parse(file, {
                header: true,
                skipEmptyLines: true,
                complete: function (results) {
                    setCsvData(results.data);
                    setHeaders(Object.keys(results.data[0] || {}));
                },
            });
            //} else if (fileExt === "pdf") {
            //    setShowWarning(true);
            //    const text = await extractTextFromPDF(file);
            //    const lines = text
            //        .split(/\r?\n/)
            //        .map((l) => l.trim())
            //        .filter(Boolean);
            //    console.log("Lines of pdf: ", lines);
            //
            //    const transactionRegex = /(\d{2}\/\d{2}\/\d{4}).*?(-?\d{1,3}(?:,\d{3})*(?:\.\d{2})?)/;
            //
            //    const parsedData = lines.map((line) => {
            //        const match = line.match(transactionRegex);
            //        return {
            //            RawLine: line,
            //            Date: match?.[1] || "",
            //            Amount: match?.[2] || "",
            //            Description: line,
            //        };
            //    });
            //
            //    setCsvData(parsedData);
            //    setHeaders(Object.keys(parsedData[0] || {}));
        } else {
            alert("Unsupported file type. Please upload CSV or PDF.");
        }
    };

    const handleDrop = (e) => {
        e.preventDefault();
        setIsDragOver(false);
        if (e.dataTransfer.files.length > 0) {
            handleFile(e.dataTransfer.files[0]);
        }
    };

    const handleSubmit = (e) => {
        e.preventDefault();
        if (!amountColumn || !descriptionColumn) {
            alert("Please select both amount and description columns.");
            return;
        }
        console.log("date index: ", headers.indexOf(dateColumn));

        handleImport({
            csvData,
            amountColumn: amountColumn,
            descriptionColumn: descriptionColumn,
            dateColumn: dateColumn,
            cardId: selectedCardId,
            discardNegatives: discardNegatives,
            addMultipleMonths: addMultipleMonths
        });
        resetModal();
        setShowImportModal(false);

    };

    return (
        showImportModal && (
            <div className="modal-overlay">
                <div className="modal-content">
                    <button
                        onClick={() => { setShowImportModal(false); resetModal(); }}
                        className="btn-close"
                    >
                        ×
                    </button>

                    <h3 className="modal-title">Import Expense</h3>

                    <form onSubmit={handleSubmit}>
                        <div
                            className={`drop-zone${isDragOver ? " is-dragging" : ""}`}
                            onClick={() => document.getElementById("fileInput").click()}
                            onDragOver={(e) => {
                                e.preventDefault();
                                setIsDragOver(true);
                            }}
                            onDragLeave={() => setIsDragOver(false)}
                            onDrop={handleDrop}
                        >
                            {headers.length === 0
                                ? "Drag & drop a CSV file here or click to select"
                                : `File loaded with ${headers.length} columns`}
                            <input
                                id="fileInput"
                                type="file"
                                accept=".csv"
                                className="visually-hidden-input"
                                onChange={(e) => handleFile(e.target.files[0])}
                            />
                        </div>

                        {headers.length > 0 && (
                            <>
                                <div className="form-group">
                                    <label className="form-label">Card:</label>
                                    <select
                                        value={selectedCardId}
                                        onChange={(e) => setSelectedCardId(e.target.value)}
                                        className="form-select"
                                        required
                                    >
                                        <option value="">Select a card</option>
                                        {creditCards.map(card => (
                                            <option key={card.id} value={card.id}>
                                                {card.nickname || card.name} - {card.institution}
                                            </option>
                                        ))}
                                    </select>
                                </div>
                                <div className="import-column-row">
                                    <label>Select Date Column:</label>
                                    <select
                                        value={dateColumn}
                                        onChange={(e) => setDateColumn(e.target.value)}
                                        className="form-select import-column-select"
                                    >
                                        <option value="">-- Select --</option>
                                        {headers.map((h, idx) => (
                                            <option key={idx} value={h}>
                                                {h}
                                            </option>
                                        ))}
                                    </select>
                                </div>
                                <div className="import-column-row">
                                    <label>Select Description Column:</label>
                                    <select
                                        value={descriptionColumn}
                                        onChange={(e) => setDescriptionColumn(e.target.value)}
                                        className="form-select import-column-select"
                                    >
                                        <option value="">-- Select --</option>
                                        {headers.map((h, idx) => (
                                            <option key={idx} value={h}>
                                                {h}
                                            </option>
                                        ))}
                                    </select>
                                </div>
                                <div className="import-column-row">
                                    <label>Select Amount Column:</label>
                                    <select
                                        value={amountColumn}
                                        onChange={(e) => setAmountColumn(e.target.value)}
                                        className="form-select import-column-select"
                                    >
                                        <option value="">-- Select --</option>
                                        {headers.map((h, idx) => (
                                            <option key={idx} value={h}>
                                                {h}
                                            </option>
                                        ))}
                                    </select>
                                </div>
                                <div className="form-group">
                                    <label>
                                        <input
                                            type="checkbox"
                                            checked={discardNegatives}
                                            onChange={(e) => setDiscardNegatives(e.target.checked)}
                                            className="form-checkbox"
                                        />
                                        Discard Negatives
                                    </label>
                                </div>
                                <div className="form-group">
                                    <label>
                                        <input
                                            type="checkbox"
                                            checked={addMultipleMonths}
                                            onChange={(e) => setAddMultipleMonths(e.target.checked)}
                                            className="form-checkbox"
                                        />
                                        Add Data From Multiple Months
                                    </label>
                                </div>
                            </>
                        )}
                        {showWarning && (
                            <div className="import-warning">
                                PDF detected: We'll make our best effort to extract data, but mapping may not be perfect.
                            </div>
                        )}

                        <div className="form-actions-center">
                            <button type="submit" className="btn-success">
                                Import
                            </button>
                        </div>
                    </form>
                </div>
            </div>

        )
    );
};

export default ImportModal;
