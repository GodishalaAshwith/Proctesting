import { exec } from "child_process";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export function runAgentPipeline(input) {
  return new Promise((resolve, reject) => {
    // Assuming python is available in the environment
    const pythonScript = path.join(__dirname, "agent.py");
    const escapedInput = input.replace(/"/g, '\\"'); // escape double quotes
    
    // Use python executable (or python3 on some systems)
    const command = `python "${pythonScript}" "${escapedInput}"`;
    
    exec(command, (error, stdout, stderr) => {
      if (error) {
        console.error("Error executing Python script:", stderr);
        return reject(error);
      }
      
      try {
        const result = JSON.parse(stdout);
        if (result.error) {
           return reject(new Error(result.error));
        }
        resolve(result);
      } catch (parseError) {
        console.error("Failed to parse python output:", stdout);
        reject(parseError);
      }
    });
  });
}
