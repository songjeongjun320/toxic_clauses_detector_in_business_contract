import { NextResponse } from "next/server";
import { Groq } from "groq-sdk";
import fs from "fs/promises";
import path from "path";
import { exec } from "child_process"; // exec을 사용하여 Python command 실행
import { promisify } from "util";

// Helper function to execute the Python script as a promise
function runPythonScript(command: string) {
  return new Promise((resolve, reject) => {
    console.log(`Executing command: ${command}`); // Log the command being executed
    exec(command, (error, stdout, stderr) => {
      if (error) {
        console.error(`Error executing script: ${stderr}`);
        reject(stderr);
      } else {
        console.log(`Script output: ${stdout}`);
        resolve(stdout);
      }
    });
  });
}

async function getAvailableDirectory(baseDirectory: string): Promise<string> {
  let currentDir = baseDirectory;
  let index = 1;

  while (true) {
    try {
      await fs.access(currentDir);
      // If the directory exists, we create a new name by appending a number
      currentDir = `${baseDirectory}${index}`;
      index += 1;
    } catch (error) {
      // If the directory doesn't exist, we return it
      return currentDir;
    }
  }
}

export async function POST(request: Request) {
  console.log("POST request received"); // Debugging log
  try {
    const splitDir = path.join(process.cwd(), "app/db/split_txt_here");
    console.log("Split directory set to:", splitDir);

    // Read text files from the split directory
    const files = await fs.readdir(splitDir);
    const textFiles = files.filter((file) => file.endsWith(".txt"));

    console.log("Text files found:", textFiles); // Debugging log

    // Define the Python command to run
    const command = `"C:/Users/frank/Desktop/toxic_clauses_detector_in_business_contract/.venv/Scripts/python.exe" C:/Users/frank/Desktop/toxic_clauses_detector_in_business_contract/app/api/process-groq/model_create.py`;

    console.log("Executing Python script..."); // Debugging log

    // Execute the Python command using the helper function
    const stdout = await runPythonScript(command); // Use the helper function here

    // Log the script output
    console.log("Python script executed successfully, output:", stdout); // Debugging log

    // Parse the output from the Python script
    const toxicityResult = JSON.parse(String(stdout).trim());

    console.log("Parsed toxicityResult:", toxicityResult); // Debugging log

    // Define toxicity categories
    const allItemsList = toxicityResult.all_items;
    const highItems = toxicityResult.high_toxicity_items;
    const mediumItems = toxicityResult.medium_toxicity_items;
    const lowItems = toxicityResult.low_toxicity_items;

    console.log("Toxicity items categorized"); // Debugging log

    // Initialize baseData
    let baseData: Record<string, string[]> = {};
    allItemsList.forEach((item: string) => {
      baseData[item] = [];
    });

    console.log("Base data initialized:", baseData); // Debugging log

    const base_directory = path.join(process.cwd(), "app/db/result");
    const RESULT_DIRECTORY = await getAvailableDirectory(base_directory);

    // Ensure result directory exists
    try {
      await fs.access(RESULT_DIRECTORY);
    } catch {
      await fs.mkdir(RESULT_DIRECTORY, { recursive: true });
    }

    // Path for base data
    const baseDataFilePath = path.join(RESULT_DIRECTORY, "base_data.json");
    const finalResultFilePath = path.join(RESULT_DIRECTORY, "all_results.json");

    // Create base_data.json if it doesn't exist
    try {
      await fs.access(baseDataFilePath);
    } catch {
      await fs.writeFile(baseDataFilePath, JSON.stringify(baseData, null, 2));
      await fs.writeFile(
        finalResultFilePath,
        JSON.stringify(baseData, null, 2)
      );
    }

    console.log("Base data file checked and created if not existing"); // Debugging log

    // =============================================================================================
    // AI API Start here
    const groq = new Groq({
      apiKey: process.env.GROQ_API_KEY,
    });

    // Process each text file
    const results = await Promise.all(
      textFiles.map(async (fileName) => {
        const filePath = path.join(splitDir, fileName);
        const text = await fs.readFile(filePath, "utf-8");

        console.log(`Processing file: ${fileName}`); // Debugging log

        try {
          console.time(`Groq API request for ${fileName}`);

          // Send request to Groq API
          const response = await groq.chat.completions.create({
            messages: [
              {
                role: "system",
                content: `This is a base_data.json file containing keys that represent clauses in a business contract: ${JSON.stringify(
                  baseData
                )}. Analyze the provided text and categorize the clauses according to these keys. Follow the rules below:
            
                1. Do not create new keys.
                2. Only use the existing keys from base_data.json.
                3. Respond with a JSON format that matches the exact structure of base_data.json.
                4. Extract relevant sentences from the provided text and add them as values in string format under the appropriate key in base_data.json.
                5. If the relevant sentence is too long, summarize it to 1 or 2 sentences.`,
              },
              {
                role: "user",
                content: `Ensure the response format matches base_data.json. No comments, Just .json format\n\n${text}`,
              },
            ],
            model: "llama3-70b-8192",
          });

          console.timeEnd(`Groq API request for ${fileName}`);

          // Parse response from Groq API
          let jsonContent =
            response.choices?.[0]?.message?.content?.trim() || "";

          // API 결과를 콘솔에 출력
          console.log(
            `Groq response start ====================================================`
          );
          console.log(`${fileName}:`, jsonContent);
          console.log(
            `Groq response end =======================================================`
          );

          // Extract only the JSON part (starting from first '{' to last '}')
          if (jsonContent.includes("{") && jsonContent.includes("}")) {
            const startIndex = jsonContent.indexOf("{");
            const endIndex = jsonContent.lastIndexOf("}");
            jsonContent = jsonContent.substring(startIndex, endIndex + 1);
          }

          let categorizedClauses;
          try {
            categorizedClauses = JSON.parse(jsonContent);
            console.log("Parsed categorized clauses:", categorizedClauses); // Debugging log
          } catch (error) {
            console.error(
              `Error parsing Groq response for ${fileName}:`,
              error
            );
            categorizedClauses = baseData; // Fallback to baseData
          }

          // Path to save all results
          const resultFileName = "all_results.json";
          const resultFilePath = path.join(RESULT_DIRECTORY, resultFileName);

          let existingData: Record<string, any[]> = {}; // Define existingData with a specific type
          const existingFileContent = await fs.readFile(
            resultFilePath,
            "utf-8"
          );
          existingData = JSON.parse(existingFileContent);

          // Append new results to existing data
          Object.keys(categorizedClauses).forEach((key) => {
            if (Array.isArray(existingData[key])) {
              // If key already exists and is an array, append new data
              existingData[key].push(...categorizedClauses[key]);
            } else {
              // If key doesn't exist, create a new array with the new data
              existingData[key] = categorizedClauses[key];
            }
          });

          // Save updated results to JSON file
          await fs.writeFile(
            resultFilePath,
            JSON.stringify(existingData, null, 2)
          );
          console.log("Saved updated result to JSON file:", resultFileName);

          return { fileName: resultFileName, filePath: resultFilePath };
        } catch (error) {
          console.error(`Error processing ${fileName}:`, error);
          return {
            fileName: fileName,
            error: (error as Error).message || String(error),
          };
        }
      })
    );

    const successfulResults = results.filter((result) => !result.error);
    const errors = results.filter((result) => result.error);

    // Log success and errors
    console.log("Successful results count:", successfulResults.length);
    console.log("Errors count:", errors.length);

    // Check if no files were successfully processed
    if (successfulResults.length === 0) {
      throw new Error("No files were successfully processed.");
    }

    // Trigger final result processing (call processFinalResults)
    console.log("Triggering final result processing...");

    // 새로운 로직: all_results.json에서 각 키를 high, medium, low로 분류하여 최종 결과에 반영합니다.
    const allResultsPath = path.join(RESULT_DIRECTORY, "all_results.json");
    let finalHigh: string[] = [];
    let finalMedium: string[] = [];
    let finalLow: string[] = [];

    try {
      const allResultsContent = await fs.readFile(allResultsPath, "utf-8");
      const allResults = JSON.parse(allResultsContent);

      // 키 값을 기준으로 각 문장을 분류하여 high, medium, low 리스트에 추가
      Object.keys(allResults).forEach((key) => {
        const values = allResults[key];
        if (highItems.includes(key)) {
          finalHigh.push(...values);
        } else if (mediumItems.includes(key)) {
          finalMedium.push(...values);
        } else if (lowItems.includes(key)) {
          finalLow.push(...values);
        }
      });

      // final_results.json 파일을 생성 및 저장
      const finalResults = {
        high: finalHigh,
        medium: finalMedium,
        low: finalLow,
      };

      const finalResultsPath = path.join(
        RESULT_DIRECTORY,
        "final_results.json"
      );
      await fs.writeFile(
        finalResultsPath,
        JSON.stringify(finalResults, null, 2)
      );
      console.log("Final results saved to final_results.json");
    } catch (error) {
      console.error("Error reading or writing JSON files:", error);
    }

    return NextResponse.json({ results: successfulResults, errors });
  } catch (error) {
    console.error("Processing error:", error);
    return NextResponse.json(
      {
        error: "Failed to process request.",
        details: (error as Error).message || String(error),
      },
      { status: 500 }
    );
  }
}
