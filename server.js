
const express = require("express");
const fs = require("fs/promises");
const path = require("path");

const app = express();
const PORT = 3000;

app.use(express.json());

const dataDirectory = path.join(__dirname, "data");
const dataFile = path.join(dataDirectory, "innings.json");

let innings = [];

// Load innings from JSON file at startup
async function loadInnings() {
    await fs.mkdir(dataDirectory, { recursive: true });

    try {
        const fileData = await fs.readFile(dataFile, "utf8");
        const parsedData = JSON.parse(fileData);

        if (!Array.isArray(parsedData)) {
            throw new Error("innings.json must contain an array");
        }

        innings = parsedData;
        console.log(`${innings.length} innings loaded successfully.`);
    } catch (error) {
        if (error.code !== "ENOENT") {
            throw error;
        }

        innings = [];
        await saveInnings(innings);
        console.log("Created an empty innings.json file.");
    }
}

// Save innings to JSON file
async function saveInnings(updatedInnings) {
    const temporaryFile = `${dataFile}.tmp`;

    await fs.writeFile(
        temporaryFile,
        JSON.stringify(updatedInnings, null, 2),
        "utf8"
    );

    await fs.rename(temporaryFile, dataFile);
}

// GET /innings - List all innings with optional filters
app.get("/innings", (req, res) => {
    let filteredInnings = [...innings];

    const { player, minRuns } = req.query;

    if (player !== undefined) {
        if (typeof player !== "string" || !player.trim()) {
            return res.status(400).json({
                success: false,
                message: "Player filter cannot be empty"
            });
        }

        filteredInnings = filteredInnings.filter(
            item => item.player.toLowerCase() === player.trim().toLowerCase()
        );
    }

    if (minRuns !== undefined) {
        const minimumRuns = Number(minRuns);

        if (
            minRuns.trim() === "" ||
            !Number.isFinite(minimumRuns) ||
            minimumRuns < 0
        ) {
            return res.status(400).json({
                success: false,
                message: "minRuns must be a non-negative number"
            });
        }

        filteredInnings = filteredInnings.filter(
            item => item.runs >= minimumRuns
        );
    }

    res.status(200).json({
        success: true,
        count: filteredInnings.length,
        data: filteredInnings
    });
});

// GET /innings/stats - Get match statistics
app.get("/innings/stats", (req, res) => {
    const totalRuns = innings.reduce(
        (total, item) => total + item.runs,
        0
    );

    const highestScore = innings.length > 0
        ? innings.reduce((highest, item) =>
            item.runs > highest.runs ? item : highest
        )
        : null;

    // Calculate each player's total runs across all innings
    const playerTotals = {};

    for (const item of innings) {
        playerTotals[item.player] =
            (playerTotals[item.player] || 0) + item.runs;
    }

    let topScorer = null;

    for (const [player, runs] of Object.entries(playerTotals)) {
        if (topScorer === null || runs > topScorer.runs) {
            topScorer = { player, runs };
        }
    }

    res.status(200).json({
        success: true,
        data: {
            totalRuns,
            highestScore: highestScore
                ? {
                    player: highestScore.player,
                    runs: highestScore.runs
                }
                : null,
            playerWithMostRuns: topScorer
        }
    });
});

// POST /innings - Add a new innings
app.post("/innings", async (req, res, next) => {
    try {
        const body = req.body;

        if (!body || typeof body !== "object" || Array.isArray(body)) {
            return res.status(400).json({
                success: false,
                message: "Request body must be a JSON object"
            });
        }

        const { player, runs, ballsFaced, notOut } = body;

        if (typeof player !== "string" || !player.trim()) {
            return res.status(400).json({
                success: false,
                message: "Player name is required"
            });
        }

        if (
            typeof runs !== "number" ||
            !Number.isFinite(runs) ||
            runs < 0
        ) {
            return res.status(400).json({
                success: false,
                message: "Runs must be a non-negative number"
            });
        }

        if (
            ballsFaced !== undefined &&
            (!Number.isInteger(ballsFaced) || ballsFaced < 0)
        ) {
            return res.status(400).json({
                success: false,
                message: "Balls faced must be a non-negative integer"
            });
        }

        if (
            notOut !== undefined &&
            typeof notOut !== "boolean"
        ) {
            return res.status(400).json({
                success: false,
                message: "notOut must be true or false"
            });
        }

        const highestId = innings.reduce(
            (max, item) => Math.max(max, Number(item.id) || 0),
            0
        );

        const newInnings = {
            id: String(highestId + 1),
            player: player.trim(),
            runs,
            ballsFaced: ballsFaced === undefined ? 0 : ballsFaced,
            notOut: notOut === undefined ? false : notOut
        };

        const updatedInnings = [...innings, newInnings];

        await saveInnings(updatedInnings);
        innings = updatedInnings;

        res.status(201).json({
            success: true,
            message: "Innings added successfully",
            data: newInnings
        });
    } catch (error) {
        next(error);
    }
});

// PATCH /innings/:id/not-out - Mark an innings as not out
app.patch("/innings/:id/not-out", async (req, res, next) => {
    try {
        const inningsIndex = innings.findIndex(
            item => item.id === req.params.id
        );

        if (inningsIndex === -1) {
            return res.status(404).json({
                success: false,
                message: "Innings not found"
            });
        }

        const updatedEntry = {
            ...innings[inningsIndex],
            notOut: true
        };

        const updatedInnings = [...innings];
        updatedInnings[inningsIndex] = updatedEntry;

        await saveInnings(updatedInnings);
        innings = updatedInnings;

        res.status(200).json({
            success: true,
            message: "Innings marked as not out",
            data: updatedEntry
        });
    } catch (error) {
        next(error);
    }
});

// Handle unknown routes
app.use((req, res) => {
    res.status(404).json({
        success: false,
        message: "Route not found"
    });
});

// Handle invalid JSON and other errors
app.use((err, req, res, next) => {
    if (err instanceof SyntaxError && err.status === 400 && "body" in err) {
        return res.status(400).json({
            success: false,
            message: "Invalid JSON request body"
        });
    }

    console.error("Server error:", err.message);

    res.status(500).json({
        success: false,
        message: "Internal server error"
    });
});

// Start server only after loading data
async function startServer() {
    try {
        await loadInnings();

        app.listen(PORT, () => {
            console.log(`Gully Cricket API running at http://localhost:${PORT}`);
        });
    } catch (error) {
        console.error("Unable to start server:", error.message);
        process.exit(1);
    }
}

startServer();
