import io
import os
import shutil
import tempfile
import traceback
from typing import List

from fastapi import FastAPI, File, Form, UploadFile, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse

# Reuse existing generation logic (now in same directory)
import copying_and_modifying_slide as gen
from pptx import Presentation
from pptx.util import Inches
import json
import importlib


ALLOWED_HOTELS = {
    "JARDINS DE LA KOUTOUBIA",
    "SOFITEL MARRAKECH PALAIS IMPERIAL",
    "BARCELO PALMERAIE",
    "KENZI ROSE GARDEN",
    "HIVERNAGE",
    "DAR SABRA",
    "RIAD AL JAZIRA",
    "HOTEL IBEROSTAR",
    "HOTEL RADISSON",
    "PURE HOUSE",
    "HOTEL DU GOLF, PICKALBATROS",
    "VILLA ALBAICIN",
    "VILLA ANTHEA",
    "MAMOUNIA",
    "FELLAH",
    "ES SAADI",
    "MOVENPICK",
    "DOMAINE DE LA ROSERAIE",
    "PALAIS RONSARD HOTEL",
    "TIGMIZA",
    "KASBAH D'IF",
    "PARK HYATT",
    "BIVOUAC SOUS LES ETOILES",
    "INARA CAMP",
}


def simplify_error_message(error: Exception) -> str:
    """Convert complex error messages into user-friendly ones"""
    error_str = str(error)
    error_type = type(error).__name__
    
    # Handle specific common errors
    if "WEBP" in error_str or "unsupported image format" in error_str:
        return "ERROR: Image format not supported. Please use JPEG, PNG, BMP, GIF, or TIFF format. WEBP is not supported."
    
    if "FileNotFoundError" in error_type or "No such file" in error_str:
        if "index.json" in error_str:
            return "ERROR: Missing index.json file. Please ensure all template files are downloaded."
        if ".pptx" in error_str:
            return f"ERROR: Missing PowerPoint template file. Please check that all template files are available."
        return f"ERROR: Required file not found: {error_str.split()[-1] if error_str.split() else 'unknown'}"
    
    if "IndexError" in error_type or "list index out of range" in error_str:
        return "ERROR: Slide index out of range. Please check the slide number in the template file."
    
    if "KeyError" in error_type:
        key = error_str.split("'")[1] if "'" in error_str else "unknown"
        return f"ERROR: Missing data for '{key}'. Please check index.json configuration."
    
    # Extract the main error message (usually the last line or the ValueError message)
    if "ValueError" in error_type:
        # Try to extract the meaningful part
        if ":" in error_str:
            return f"ERROR: {error_str.split(':', 1)[-1].strip()}"
        return f"ERROR: {error_str}"
    
    # For other errors, return a simplified version
    if len(error_str) > 200:
        return f"ERROR: {error_type}: {error_str[:150]}..."
    
    return f"ERROR: {error_type}: {error_str}"


def write_inputs_py(tmp_dir: str, payload: dict) -> None:
    inputs_path = os.path.join(tmp_dir, "inputs.py")
    with open(inputs_path, "w", encoding="utf-8") as f:
        f.write(f'input_0_A = "{payload["logo_path"]}"\n')
        f.write(f'input_0_B = "{payload["dates"]}"\n')

        f.write(f'input_1_A = "{payload["client"]}"\n')
        f.write(f'input_1_B = "{payload["num_people"]}"\n')
        f.write(f'input_1_C = "{payload["num_days"]}"\n')
        f.write(f'input_1_D = "{payload["num_nights"]}"\n')
        f.write(f'input_1_E = "Du {payload["dates"]}"\n')

        # Hotel rooms mapping like in the desktop UI
        for hotel in payload.get("hotels", []):
            name = hotel.get("hotelName", "")
            rooms = str(hotel.get("rooms", ""))
            if "KOUTOUBIA" in name:
                f.write(f'input_koutoubia_5 = "{rooms}"\n')
            elif "SOFITEL" in name:
                f.write(f'input_sofitel_3 = "{rooms}"\n')
            # else: other hotels currently do not have direct input bindings


def load_index_json(work_dir: str = ".") -> dict:
    index_path = os.path.join(work_dir, "index.json")
    print(f"DEBUG: Loading index.json from: {os.path.abspath(index_path)}")
    if not os.path.exists(index_path):
        print(f"DEBUG: ERROR - index.json not found at {index_path}")
        print(f"DEBUG: Current directory: {os.getcwd()}")
        print(f"DEBUG: Files in current dir: {os.listdir('.')[:10]}")
    with open(index_path, "r", encoding="utf-8") as fh:
        data = json.load(fh)
        print(f"DEBUG: Loaded {len(data)} entries from index.json")
        return data


def generate_pptx(tmp_work_dir: str, payload: dict) -> bytes:
    import gc  # For garbage collection
    
    # Ensure we're in the backend directory (where PPTX files and index.json are)
    original_cwd = os.getcwd()
    backend_dir = os.path.dirname(os.path.abspath(__file__))
    os.chdir(backend_dir)
    print(f"DEBUG: Changed to backend directory: {backend_dir}")
    
    try:
        # Write inputs.py and reload module
        write_inputs_py(".", payload)
        import inputs
        importlib.reload(inputs)

        data = load_index_json(".")

        output_pres = Presentation()
        output_pres.slide_width = Inches(13.33)
        output_pres.slide_height = Inches(7.5)
        
        # Force garbage collection after setup
        gc.collect()

        # First slides
        for i in range(1, 7):
            try:
                gen.NewSlide(i, "Slides_DEBUT_FIN.pptx", output_pres)
            except Exception:
                pass
        
        # Force garbage collection after first slides
        gc.collect()

        # Multiple hotels slide
        if len(payload.get("hotels", [])) > 1:
            try:
                gen.NewSlide(1, "liste_HOTELS.pptx", output_pres)
            except Exception:
                pass

        # Hotel slides
        for h in payload.get("hotels", []):
            hotel_name = h.get("hotelName")
            print(f"DEBUG: Processing hotel: '{hotel_name}'")
            print(f"DEBUG: Hotel in data: {hotel_name in data}")
            if not hotel_name:
                print(f"DEBUG: Skipping hotel - no name")
                continue
            if hotel_name not in data:
                print(f"DEBUG: Skipping hotel '{hotel_name}' - not found in index.json")
                print(f"DEBUG: Available hotels (first 5): {list(data.keys())[:5]}")
                continue
            link = data[hotel_name]["ppt"]
            slide_index = data[hotel_name]["index"]
            nb_slides = data[hotel_name]["nb_slides"]
            print(f"DEBUG: Adding hotel slides: {hotel_name}, index {slide_index}, nb_slides {nb_slides}")
            for i in range(slide_index - 1, slide_index + nb_slides - 1):
                try:
                    gen.NewSlide(i, link, output_pres)
                except Exception as e:
                    print(f"DEBUG: Error adding slide {i} for {hotel_name}: {e}")
                    pass
        
        # Force garbage collection after hotel slides
        gc.collect()

        # Agenda
        # dayPlans is a list of {date, steps}
        activities_by_day = [dp.get("steps", []) for dp in payload.get("dayPlans", [])]
        print(f"DEBUG: Activities by day: {activities_by_day}")
        # Preserve legacy extra tail element behavior
        activities_by_day.append([])
        gen.make_agenda(output_pres, activities_by_day)
        
        # Force garbage collection after agenda
        gc.collect()

        # Slide for flights
        gen.NewSlide(119, "liste_ACTIVITES.pptx", output_pres)

        # Manual notes slides (before day activities)
        for day_index, day_data in enumerate(payload.get("dayPlans", [])):
            manual_notes = day_data.get("manualNotes", [])
            for note in manual_notes:
                if note and note.strip():
                    try:
                        gen.create_manual_note_slide(output_pres, note.strip())
                        print(f"DEBUG: Added manual note slide for day {day_index + 1}: {note[:50]}...")
                    except Exception as e:
                        print(f"DEBUG: Error adding manual note slide: {e}")
                        pass

        # Inter-days and activities
        for day_index, day_plan in enumerate(activities_by_day[:-1]):
            day_date = payload.get("dayPlans", [{}])[day_index].get("date", "")

            # Slides between days based on number of steps
            if len(day_plan) in (2, 3, 4, 5, 6):
                mapping = {2: 1, 3: 2, 4: 3, 5: 4, 6: 5}
                try:
                    gen.CopyAndModifySlide(mapping[len(day_plan)], output_pres, day_plan, day_index + 1, day_date)
                except Exception:
                    pass

            # Copy referenced slides for each step
            for etape in day_plan:
                print(f"DEBUG: Processing activity: '{etape}'")
                if etape not in data:
                    print(f"DEBUG: Activity '{etape}' not found in index.json")
                    print(f"DEBUG: Available activities (first 5): {list([k for k in data.keys() if data[k].get('ppt') == 'liste_ACTIVITES.pptx' or data[k].get('ppt') == 'liste_REPAS.pptx'])[:5]}")
                    continue
                link = data[etape].get("ppt")
                if link == "FALSE":
                    print(f"DEBUG: Skipping '{etape}' - ppt is FALSE")
                    continue
                slide_index = data[etape]["index"]
                nb_slides = data[etape]["nb_slides"]
                print(f"DEBUG: Adding activity slides: {etape}, index {slide_index}, nb_slides {nb_slides}")
                for i in range(slide_index - 1, slide_index + nb_slides - 1):
                    try:
                        gen.NewSlide(i, link, output_pres)
                    except Exception as e:
                        print(f"DEBUG: Error adding slide {i} for {etape}: {e}")
                        pass
            
            # Force garbage collection after each day
            gc.collect()

        # Last slides
        for i in range(8, 17):
            try:
                gen.NewSlide(i, "Slides_DEBUT_FIN.pptx", output_pres)
            except Exception:
                pass
        
        # Force garbage collection before final save
        gc.collect()

        # Save to bytes
        buf = io.BytesIO()
        output_pres.save(buf)
        buf.seek(0)
        result = buf.read()
        buf.close()
        
        # Final cleanup
        del output_pres
        del data
        gc.collect()
        
        return result
    finally:
        # Restore original working directory
        os.chdir(original_cwd)


app = FastAPI()

# CORS for Netlify (can be restricted later)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.post("/generate")
async def generate(
    client: str = Form(...),
    dates: str = Form(...),
    numDays: int = Form(...),
    numNights: int = Form(...),
    numPeople: int = Form(...),
    hotels: str = Form("[]"),  # JSON string
    dayPlans: str = Form("[]"),  # JSON string
    logo: UploadFile = File(None),
):
    if numDays < 1 or numDays > 8:
        raise HTTPException(status_code=422, detail="numDays must be between 1 and 8")

    try:
        hotels_list = json.loads(hotels)
        plans_list = json.loads(dayPlans)
        print(f"DEBUG: Received hotels: {hotels_list}")
        print(f"DEBUG: Received dayPlans: {plans_list}")
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid JSON in hotels or dayPlans")

    # Validate hotels are from allowed list
    for h in hotels_list:
        name = h.get("hotelName")
        if name not in ALLOWED_HOTELS:
            raise HTTPException(status_code=400, detail=f"Unknown hotel: {name}")

    # Store uploaded logo to current directory for relative path compatibility
    logo_path = "logo_1.jpg"  # Default logo if none provided
    if logo and logo.filename:
        logo_filename = f"uploaded_logo_{os.getpid()}.png"
        logo_path = os.path.join(".", logo_filename)
        with open(logo_path, "wb") as out:
            shutil.copyfileobj(logo.file, out)

    payload = {
        "client": client,
        "dates": dates,
        "num_days": str(numDays),
        "num_nights": str(numNights),
        "num_people": str(numPeople),
        "hotels": hotels_list,
        "dayPlans": plans_list,
        "logo_path": logo_path,
    }

    try:
        pptx_bytes = generate_pptx(".", payload)
    except Exception as e:
        # Log full error for debugging (will appear in Render logs)
        error_traceback = traceback.format_exc()
        print(f"FULL ERROR TRACEBACK:\n{error_traceback}")
        print(f"ERROR TYPE: {type(e).__name__}")
        print(f"ERROR MESSAGE: {str(e)}")
        
        # Return simplified error message to user
        simplified_error = simplify_error_message(e)
        print(f"SIMPLIFIED ERROR (returned to user): {simplified_error}")
        
        raise HTTPException(status_code=500, detail=simplified_error)
    finally:
        # Only remove uploaded logo, not default logo
        if logo and logo.filename and logo_path != "logo_1.jpg":
            try:
                os.remove(logo_path)
            except Exception:
                pass

    # Generate filename with client name
    sanitized_client = "".join(c if c.isalnum() or c in (' ', '-', '_') else '_' for c in client).strip()
    if not sanitized_client:
        sanitized_client = "client"
    sanitized_client = sanitized_client.replace(' ', '_')
    filename = f"presentation_marrakech_{sanitized_client}.pptx"
    
    return StreamingResponse(
        io.BytesIO(pptx_bytes),
        media_type="application/vnd.openxmlformats-officedocument.presentationml.presentation",
        headers={
            "Content-Disposition": f'attachment; filename="{filename}"'
        },
    )


@app.get("/")
async def root():
    return {"status": "ok"}

@app.get("/debug")
async def debug():
    """Debug endpoint to check what files are available"""
    files = []
    for filename in os.listdir('.'):
        if os.path.isfile(filename):
            files.append(filename)
    return {
        "files": files,
        "index_json_exists": os.path.exists("index.json"),
        "working_directory": os.getcwd()
    }