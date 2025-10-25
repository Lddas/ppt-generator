import io
import os
import shutil
import tempfile
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
    "LES JARDINS DE LA KOUTOUBIA 5*",
    "SOFITEL MARRAKECH PALAIS IMPERIAL 5*",
    "BARCELO PALMERAIE 5*",
    "KENZI ROSE GARDEN HOTEL 5*",
}


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


def load_index_json() -> dict:
    with open("index.json", "r", encoding="utf-8") as fh:
        return json.load(fh)


def generate_pptx(tmp_work_dir: str, payload: dict) -> bytes:
    # Write inputs.py and reload module
    write_inputs_py(".", payload)
    import inputs
    importlib.reload(inputs)

    data = load_index_json()

    output_pres = Presentation()
    output_pres.slide_width = Inches(13.33)
    output_pres.slide_height = Inches(7.5)

    # First slides
    for i in range(1, 7):
        try:
            gen.NewSlide(i, "Slides_DEBUT_FIN.pptx", output_pres)
        except Exception:
            pass

    # Multiple hotels slide
    if len(payload.get("hotels", [])) > 1:
        try:
            gen.NewSlide(1, "liste_HOTELS.pptx", output_pres)
        except Exception:
            pass

    # Hotel slides
    for h in payload.get("hotels", []):
        hotel_name = h.get("hotelName")
        if not hotel_name or hotel_name not in data:
            continue
        link = data[hotel_name]["ppt"]
        slide_index = data[hotel_name]["index"]
        nb_slides = data[hotel_name]["nb_slides"]
        for i in range(slide_index - 1, slide_index + nb_slides - 1):
            try:
                gen.NewSlide(i, link, output_pres)
            except Exception:
                pass

    # Agenda
    # dayPlans is a list of {date, steps}
    activities_by_day = [dp.get("steps", []) for dp in payload.get("dayPlans", [])]
    # Preserve legacy extra tail element behavior
    activities_by_day.append([])
    gen.make_agenda(output_pres, activities_by_day)

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
            if etape not in data:
                continue
            link = data[etape].get("ppt")
            if link == "FALSE":
                continue
            slide_index = data[etape]["index"]
            nb_slides = data[etape]["nb_slides"]
            for i in range(slide_index - 1, slide_index + nb_slides - 1):
                try:
                    gen.NewSlide(i, link, output_pres)
                except Exception:
                    pass

    # Last slides
    for i in range(8, 18):
        try:
            gen.NewSlide(i, "Slides_DEBUT_FIN.pptx", output_pres)
        except Exception:
            pass

    # Save to bytes
    buf = io.BytesIO()
    output_pres.save(buf)
    buf.seek(0)
    return buf.read()


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
    finally:
        # Only remove uploaded logo, not default logo
        if logo and logo.filename and logo_path != "logo_1.jpg":
            try:
                os.remove(logo_path)
            except Exception:
                pass

    return StreamingResponse(
        io.BytesIO(pptx_bytes),
        media_type="application/vnd.openxmlformats-officedocument.presentationml.presentation",
        headers={
            "Content-Disposition": 'attachment; filename="presentation.pptx"'
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