import os
import sys
import asyncio
import logging
from typing import Callable, Optional

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("RobotRunner")

async def execute_robot_script(
    robot_id: str,
    script_code: str,
    log_callback: Callable[[str], None],
    status_callback: Callable[[str], None]
):
    status_callback("running")
    log_callback("Starting Selenium Robot execution...")
    
    # Save script to a file
    robots_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), "robots_temp"))
    os.makedirs(robots_dir, exist_ok=True)
    script_file_path = os.path.join(robots_dir, f"run_{robot_id}.py")
    
    with open(script_file_path, "w", encoding="utf-8") as f:
        f.write(script_code)
        
    log_callback(f"Robot script written to {script_file_path}")
    
    # Execute the python script using subprocess
    process = None
    try:
        # Determine python executable
        python_exec = sys.executable
        
        # Spawns subprocess
        process = await asyncio.create_subprocess_exec(
            python_exec, script_file_path,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
            env=os.environ.copy()
        )
        
        # Helper to read stdout/stderr streams
        async def read_stream(stream, prefix):
            while True:
                line = await stream.readline()
                if not line:
                    break
                decoded_line = line.decode('utf-8', errors='replace').rstrip('\r\n')
                log_callback(f"[{prefix}] {decoded_line}")

        # Gather stdout and stderr readings
        await asyncio.gather(
            read_stream(process.stdout, "OUT"),
            read_stream(process.stderr, "ERR")
        )
        
        return_code = await process.wait()
        
        if return_code == 0:
            status_callback("done")
            log_callback("Selenium Robot execution completed successfully.")
        else:
            status_callback("error")
            log_callback(f"Selenium Robot execution failed with exit code: {return_code}")
            
    except asyncio.CancelledError:
        if process:
            try:
                process.terminate()
                log_callback("Selenium Robot execution terminated by user request.")
            except Exception:
                pass
        status_callback("error")
        raise
    except Exception as e:
        log_callback(f"Exception during execution: {e}")
        status_callback("error")
    finally:
        # Cleanup temporary script file
        try:
            if os.path.exists(script_file_path):
                os.remove(script_file_path)
        except Exception:
            pass
