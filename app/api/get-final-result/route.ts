import { NextResponse } from "next/server";
import fs from "fs/promises";
import path from "path";

// 가장 최신의 result 디렉토리 찾기 함수 (숫자 정렬 기반)
async function getLatestResultDirectory(baseDir: string) {
  try {
    // 'app/db' 디렉토리에서 result로 시작하는 디렉토리 목록 가져오기
    const directories = await fs.readdir(baseDir, { withFileTypes: true });
    const resultDirs = directories
      .filter((dir) => dir.isDirectory() && dir.name.startsWith("result"))
      .map((dir) => dir.name)
      .map((dirName) => ({
        name: dirName,
        num: parseInt(dirName.replace("result", "")) || 0, // "result" 뒤의 숫자를 추출
      }))
      .sort((a, b) => b.num - a.num); // 숫자 순으로 내림차순 정렬

    // 가장 최신의 디렉토리 이름 반환
    return resultDirs.length > 0
      ? path.join(baseDir, resultDirs[0].name)
      : null;
  } catch (error) {
    console.error("Failed to read directories:", error);
    return null;
  }
}

export async function GET() {
  const baseDir = path.join(process.cwd(), "app/db");

  // 최신 result 디렉토리 가져오기
  const latestResultDir = await getLatestResultDirectory(baseDir);

  if (!latestResultDir) {
    console.error("No result directories found.");
    return NextResponse.json(
      { error: "No result directories found" },
      { status: 404 }
    );
  }

  // 최신 result 디렉토리 내의 final_results.json 파일 경로 설정
  const jsonFilePath = path.join(latestResultDir, "final_results.json");

  console.log("Attempting to read JSON file from: ", jsonFilePath);
  try {
    // JSON 파일을 읽고 그 내용을 반환
    const jsonData = await fs.readFile(jsonFilePath, "utf-8");
    const parsedData = JSON.parse(jsonData);
    console.log("Parsed Data:", parsedData);

    return NextResponse.json(parsedData);
  } catch (error) {
    console.error("Failed to read or parse the JSON file:", error);
    return NextResponse.json(
      { error: "Failed to read or parse the JSON file" },
      { status: 500 }
    );
  }
}
