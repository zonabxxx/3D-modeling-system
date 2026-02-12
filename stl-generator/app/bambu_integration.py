"""
bambu_integration.py – Integrácia s Bambu Lab tlačiarňami

Funkcie:
  1. Generovanie .3MF súborov (natívny formát Bambu Lab Studio)
  2. Zisťovanie tlačiarní na lokálnej sieti (SSDP discovery)
  3. Odosielanie print jobov cez MQTT + FTP (LAN mód)
  4. Monitoring stavu tlače

Podporované tlačiarne:
  - Bambu Lab X1 Carbon
  - Bambu Lab P1S / P1P
  - Bambu Lab A1 / A1 Mini

Komunikácia:
  - MQTT (port 8883 TLS) – príkazy a stavové správy
  - FTP (port 990 FTPS) – upload .3mf súborov
"""

import os
import io
import json
import ssl
import time
import uuid
import zipfile
import hashlib
import logging
from pathlib import Path
from typing import Optional, Dict, List, Any
from dataclasses import dataclass, field, asdict

logger = logging.getLogger(__name__)

# ─────────────────────────────────────────────
# Konfigurácia
# ─────────────────────────────────────────────

@dataclass
class BambuPrinter:
    """Konfigurácia Bambu Lab tlačiarne."""
    name: str = "Bambu Lab Printer"
    ip: str = ""
    serial: str = ""
    access_code: str = ""
    model: str = "unknown"  # x1c, p1s, p1p, a1, a1_mini
    # Výrobné limity
    max_x: float = 256.0
    max_y: float = 256.0
    max_z: float = 256.0

    @property
    def mqtt_topic_publish(self) -> str:
        return f"device/{self.serial}/request"

    @property
    def mqtt_topic_subscribe(self) -> str:
        return f"device/{self.serial}/report"


# Prednastavené profily tlačiarní
PRINTER_PROFILES: Dict[str, Dict[str, float]] = {
    "x1c": {"max_x": 256, "max_y": 256, "max_z": 256},
    "p1s": {"max_x": 256, "max_y": 256, "max_z": 256},
    "p1p": {"max_x": 256, "max_y": 256, "max_z": 256},
    "a1":  {"max_x": 256, "max_y": 256, "max_z": 256},
    "a1_mini": {"max_x": 180, "max_y": 180, "max_z": 180},
}


# ─────────────────────────────────────────────
# 3MF Generátor
# ─────────────────────────────────────────────

@dataclass
class ThreeMFPart:
    """Jeden diel v .3MF balíku."""
    name: str
    stl_path: str
    part_type: str  # shell, face, back
    plate: int = 1
    # Pozícia na plate
    offset_x: float = 0
    offset_y: float = 0
    offset_z: float = 0
    # Materiál
    material: str = "ASA"
    color: str = "#FFFFFF"


def generate_3mf(
    stl_files: List[str],
    output_path: str,
    project_name: str = "ADSUN Sign",
    material: str = "ASA",
    plate_layout: str = "auto",
    printer_model: str = "x1c",
    print_settings: Optional[Dict[str, Any]] = None,
) -> str:
    """
    Vygeneruje .3MF súbor z STL súborov.
    
    .3MF je ZIP archív obsahujúci:
      - [Content_Types].xml
      - 3D/3dmodel.model (mesh dáta vo formáte 3MF)
      - Metadata/plate_*.config
      - Metadata/project_settings.config
      
    Args:
        stl_files: Zoznam ciest k STL súborom
        output_path: Kam uložiť .3mf
        project_name: Názov projektu
        material: Materiál (ASA, ABS, PETG, PLA)
        plate_layout: Rozloženie na plate (auto, manual)
        printer_model: Model tlačiarne (x1c, p1s, a1, a1_mini)
        print_settings: Voliteľné nastavenia tlače
        
    Returns:
        Cesta k vygenerovanému .3mf súboru
    """
    settings = print_settings or {}
    printer = PRINTER_PROFILES.get(printer_model, PRINTER_PROFILES["x1c"])
    
    # Parsovať STL súbory a konvertovať na 3MF mesh formát
    meshes = []
    for i, stl_path in enumerate(stl_files):
        if os.path.exists(stl_path):
            mesh_data = _stl_to_3mf_mesh(stl_path, object_id=i + 1)
            meshes.append({
                "id": i + 1,
                "name": Path(stl_path).stem,
                "mesh": mesh_data,
                "stl_path": stl_path,
            })
    
    if not meshes:
        raise ValueError("Žiadne platné STL súbory na spracovanie")
    
    # Vytvoriť .3mf (ZIP)
    with zipfile.ZipFile(output_path, 'w', zipfile.ZIP_DEFLATED) as zf:
        # 1. [Content_Types].xml
        zf.writestr("[Content_Types].xml", _content_types_xml())
        
        # 2. _rels/.rels
        zf.writestr("_rels/.rels", _rels_xml())
        
        # 3. 3D/3dmodel.model – hlavný model
        model_xml = _build_3d_model(meshes, project_name)
        zf.writestr("3D/3dmodel.model", model_xml)
        
        # 4. Metadata/plate_1.config – konfigurácia platne
        plate_config = _build_plate_config(
            meshes, material, printer, settings
        )
        zf.writestr("Metadata/plate_1.config", plate_config)
        
        # 5. Metadata/project_settings.config
        project_config = _build_project_config(
            project_name, material, printer_model, settings
        )
        zf.writestr("Metadata/project_settings.config", project_config)
        
        # 6. Metadata/model_settings.config (Bambu Studio specific)
        model_settings = _build_model_settings(meshes, material, settings)
        zf.writestr("Metadata/model_settings.config", model_settings)
        
        # 7. Pridať pôvodné STL ako prílohu (Bambu Studio ich vie otvoriť)
        for mesh in meshes:
            stl_filename = Path(mesh["stl_path"]).name
            zf.write(mesh["stl_path"], f"3D/{stl_filename}")
    
    logger.info(f"3MF vygenerovaný: {output_path} ({len(meshes)} dielov)")
    return output_path


def _stl_to_3mf_mesh(stl_path: str, object_id: int = 1) -> Dict[str, Any]:
    """
    Parsuje binárny/textový STL a konvertuje na 3MF mesh dáta.
    
    Vracia dict s vertices a triangles pre 3MF XML.
    """
    vertices = []
    triangles = []
    vertex_map = {}
    
    try:
        with open(stl_path, 'rb') as f:
            header = f.read(80)
            num_triangles_bytes = f.read(4)
            
            if len(num_triangles_bytes) < 4:
                return _parse_ascii_stl(stl_path)
            
            num_triangles = int.from_bytes(num_triangles_bytes, 'little')
            
            # Kontrola – je to naozaj binárne STL?
            expected_size = 84 + num_triangles * 50
            f.seek(0, 2)
            actual_size = f.tell()
            f.seek(84)
            
            if actual_size != expected_size:
                return _parse_ascii_stl(stl_path)
            
            for _ in range(num_triangles):
                # Normal (3 floats) – preskočíme
                f.read(12)
                
                # 3 vertices (9 floats)
                tri_indices = []
                for _ in range(3):
                    vx = _read_float(f)
                    vy = _read_float(f)
                    vz = _read_float(f)
                    
                    key = (round(vx, 6), round(vy, 6), round(vz, 6))
                    if key not in vertex_map:
                        vertex_map[key] = len(vertices)
                        vertices.append(key)
                    tri_indices.append(vertex_map[key])
                
                triangles.append(tuple(tri_indices))
                
                # Attribute byte count
                f.read(2)
    except Exception as e:
        logger.warning(f"Chyba parsingu STL {stl_path}: {e}")
        # Fallback – vrátiť prázdny mesh
        return {"vertices": [], "triangles": []}
    
    return {"vertices": vertices, "triangles": triangles}


def _parse_ascii_stl(stl_path: str) -> Dict[str, Any]:
    """Parsuje ASCII STL formát."""
    vertices = []
    triangles = []
    vertex_map = {}
    
    try:
        with open(stl_path, 'r') as f:
            tri_indices = []
            for line in f:
                line = line.strip()
                if line.startswith('vertex'):
                    parts = line.split()
                    vx, vy, vz = float(parts[1]), float(parts[2]), float(parts[3])
                    key = (round(vx, 6), round(vy, 6), round(vz, 6))
                    if key not in vertex_map:
                        vertex_map[key] = len(vertices)
                        vertices.append(key)
                    tri_indices.append(vertex_map[key])
                    
                    if len(tri_indices) == 3:
                        triangles.append(tuple(tri_indices))
                        tri_indices = []
    except Exception as e:
        logger.warning(f"Chyba parsingu ASCII STL {stl_path}: {e}")
    
    return {"vertices": vertices, "triangles": triangles}


def _read_float(f) -> float:
    """Načíta 4-byte float (little-endian)."""
    import struct
    return struct.unpack('<f', f.read(4))[0]


def _content_types_xml() -> str:
    """[Content_Types].xml pre .3mf."""
    return '''<?xml version="1.0" encoding="UTF-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/>
  <Default Extension="stl" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/>
  <Default Extension="config" ContentType="text/xml"/>
</Types>'''


def _rels_xml() -> str:
    """_rels/.rels pre .3mf."""
    return '''<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Target="/3D/3dmodel.model" Id="rel-1" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/>
</Relationships>'''


def _build_3d_model(meshes: list, project_name: str) -> str:
    """Zostaví 3D/3dmodel.model XML s mesh dátami."""
    objects_xml = []
    build_items = []
    
    for mesh_info in meshes:
        obj_id = mesh_info["id"]
        name = mesh_info["name"]
        mesh = mesh_info["mesh"]
        
        # Vertices
        verts_xml = []
        for v in mesh.get("vertices", []):
            verts_xml.append(
                f'          <vertex x="{v[0]}" y="{v[1]}" z="{v[2]}"/>'
            )
        
        # Triangles
        tris_xml = []
        for t in mesh.get("triangles", []):
            tris_xml.append(
                f'          <triangle v1="{t[0]}" v2="{t[1]}" v3="{t[2]}"/>'
            )
        
        if verts_xml and tris_xml:
            objects_xml.append(f'''    <object id="{obj_id}" type="model" name="{name}">
      <mesh>
        <vertices>
{chr(10).join(verts_xml)}
        </vertices>
        <triangles>
{chr(10).join(tris_xml)}
        </triangles>
      </mesh>
    </object>''')
        
            build_items.append(
                f'    <item objectid="{obj_id}"/>'
            )
    
    return f'''<?xml version="1.0" encoding="UTF-8"?>
<model unit="millimeter" xml:lang="en-US"
  xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02"
  xmlns:p="http://schemas.microsoft.com/3dmanufacturing/production/2015/06">
  <metadata name="Title">{project_name}</metadata>
  <metadata name="Application">ADSUN 3D Configurator</metadata>
  <resources>
{chr(10).join(objects_xml)}
  </resources>
  <build>
{chr(10).join(build_items)}
  </build>
</model>'''


def _build_plate_config(
    meshes: list,
    material: str,
    printer: Dict[str, float],
    settings: Dict[str, Any],
) -> str:
    """Konfigurácia platne pre Bambu Studio."""
    # Bambu Studio predvolené nastavenia podľa materiálu
    material_temps = {
        "ASA":  {"nozzle": 260, "bed": 100, "chamber": 45},
        "ABS":  {"nozzle": 255, "bed": 100, "chamber": 45},
        "PETG": {"nozzle": 245, "bed": 70, "chamber": 0},
        "PLA":  {"nozzle": 220, "bed": 60, "chamber": 0},
    }
    
    mat = material.upper()
    temps = material_temps.get(mat, material_temps["ASA"])
    
    layer_height = settings.get("layer_height", 0.20)
    infill = settings.get("infill_percent", 20)
    wall_loops = settings.get("wall_loops", 3)
    top_layers = settings.get("top_layers", 4)
    bottom_layers = settings.get("bottom_layers", 4)
    support = settings.get("support", True)
    
    objects_config = []
    for mesh_info in meshes:
        objects_config.append(
            f'  <object id="{mesh_info["id"]}" name="{mesh_info["name"]}"/>'
        )
    
    return f'''<?xml version="1.0" encoding="UTF-8"?>
<plate>
  <metadata key="plate_index" value="1"/>
  <metadata key="plate_name" value="Plate 1"/>
  <metadata key="printer_model" value="Bambu Lab"/>
  
  <print_settings>
    <setting key="layer_height" value="{layer_height}"/>
    <setting key="initial_layer_height" value="0.20"/>
    <setting key="wall_loops" value="{wall_loops}"/>
    <setting key="top_shell_layers" value="{top_layers}"/>
    <setting key="bottom_shell_layers" value="{bottom_layers}"/>
    <setting key="sparse_infill_density" value="{infill}%"/>
    <setting key="sparse_infill_pattern" value="gyroid"/>
    <setting key="enable_support" value="{'1' if support else '0'}"/>
    <setting key="support_type" value="tree(auto)"/>
    <setting key="support_threshold_angle" value="45"/>
  </print_settings>
  
  <filament_settings>
    <setting key="filament_type" value="{mat}"/>
    <setting key="nozzle_temperature" value="{temps['nozzle']}"/>
    <setting key="bed_temperature" value="{temps['bed']}"/>
    <setting key="chamber_temperature" value="{temps['chamber']}"/>
  </filament_settings>
  
  <objects>
{chr(10).join(objects_config)}
  </objects>
</plate>'''


def _build_project_config(
    project_name: str,
    material: str,
    printer_model: str,
    settings: Dict[str, Any],
) -> str:
    """Globálne nastavenia projektu."""
    return f'''<?xml version="1.0" encoding="UTF-8"?>
<config>
  <metadata key="project_name" value="{project_name}"/>
  <metadata key="application" value="ADSUN 3D Configurator v1.0"/>
  <metadata key="printer_model" value="{printer_model}"/>
  <metadata key="material" value="{material.upper()}"/>
  <metadata key="created" value="{time.strftime('%Y-%m-%dT%H:%M:%S')}"/>
  
  <printer_settings>
    <setting key="printer_model" value="{printer_model}"/>
    <setting key="nozzle_diameter" value="{settings.get('nozzle', 0.4)}"/>
    <setting key="print_speed" value="{settings.get('speed', 100)}"/>
  </printer_settings>
</config>'''


def _build_model_settings(
    meshes: list,
    material: str,
    settings: Dict[str, Any],
) -> str:
    """Model settings pre Bambu Studio."""
    objects_xml = []
    for mesh_info in meshes:
        name = mesh_info["name"]
        # Automatický materiál podľa part_type z názvu
        part_material = material.upper()
        
        objects_xml.append(f'''  <object id="{mesh_info['id']}" name="{name}">
    <setting key="material" value="{part_material}"/>
    <setting key="extruder" value="1"/>
  </object>''')
    
    return f'''<?xml version="1.0" encoding="UTF-8"?>
<model_settings>
{chr(10).join(objects_xml)}
</model_settings>'''


# ─────────────────────────────────────────────
# Bambu Lab LAN komunikácia (MQTT + FTP)
# ─────────────────────────────────────────────

class BambuConnection:
    """
    Komunikácia s Bambu Lab tlačiarňou cez lokálnu sieť.
    
    Protokoly:
      - MQTT (port 8883 / TLS) – príkazy a stavové správy
      - FTP (port 990 / FTPS) – upload súborov
    """
    
    def __init__(self, printer: BambuPrinter):
        self.printer = printer
        self._mqtt_client = None
        self._last_status: Dict[str, Any] = {}
    
    def upload_and_print(
        self,
        file_path: str,
        filename: Optional[str] = None,
        auto_start: bool = False,
        bed_leveling: bool = True,
        ams_mapping: Optional[List[int]] = None,
    ) -> Dict[str, Any]:
        """
        Odošle .3mf súbor na tlačiareň a voliteľne spustí tlač.
        
        Postup:
          1. Upload .3mf cez FTP na SD kartu tlačiarne
          2. Odoslanie MQTT príkazu na tlač (ak auto_start=True)
          
        Args:
            file_path: Cesta k .3mf súboru
            filename: Názov súboru na SD karte (default: pôvodný)
            auto_start: Automaticky spustiť tlač
            bed_leveling: Vykonať bed leveling pred tlačou
            ams_mapping: Mapovanie AMS slotov [slot1, slot2, ...]
            
        Returns:
            Dict s výsledkom operácie
        """
        if not os.path.exists(file_path):
            return {"success": False, "error": f"Súbor neexistuje: {file_path}"}
        
        if not self.printer.ip:
            return {"success": False, "error": "Nie je nastavená IP adresa tlačiarne"}
        
        if not self.printer.access_code:
            return {"success": False, "error": "Nie je nastavený access code tlačiarne"}
        
        fname = filename or Path(file_path).name
        
        # 1. Upload cez FTP
        ftp_result = self._upload_ftp(file_path, fname)
        if not ftp_result["success"]:
            return ftp_result
        
        result = {
            "success": True,
            "uploaded": True,
            "filename": fname,
            "printer": self.printer.name,
            "printer_ip": self.printer.ip,
        }
        
        # 2. Spustiť tlač cez MQTT (ak požadované)
        if auto_start:
            mqtt_result = self._send_print_command(
                fname, bed_leveling, ams_mapping
            )
            result["print_started"] = mqtt_result.get("success", False)
            if not mqtt_result.get("success"):
                result["print_error"] = mqtt_result.get("error", "Unknown")
        
        return result
    
    def _upload_ftp(self, local_path: str, remote_filename: str) -> Dict[str, Any]:
        """Upload súboru cez FTPS na SD kartu tlačiarne."""
        try:
            from ftplib import FTP_TLS
            
            ftp = FTP_TLS()
            ftp.connect(self.printer.ip, 990, timeout=30)
            
            # Bambu Lab používa "bblp" ako username, access_code ako heslo
            ftp.login("bblp", self.printer.access_code)
            ftp.prot_p()  # Zapnúť dátovú šifráciu
            
            # Nahrať na SD kartu
            remote_path = f"/sdcard/{remote_filename}"
            
            with open(local_path, 'rb') as f:
                file_size = os.path.getsize(local_path)
                logger.info(
                    f"FTP upload: {remote_filename} ({file_size / 1024:.1f} KB) "
                    f"→ {self.printer.ip}"
                )
                ftp.storbinary(f"STOR {remote_path}", f)
            
            ftp.quit()
            
            return {
                "success": True,
                "remote_path": remote_path,
                "size_bytes": file_size,
            }
            
        except ImportError:
            return {"success": False, "error": "FTP knižnica nie je dostupná"}
        except Exception as e:
            logger.error(f"FTP upload chyba: {e}")
            return {"success": False, "error": f"FTP chyba: {str(e)}"}
    
    def _send_print_command(
        self,
        filename: str,
        bed_leveling: bool = True,
        ams_mapping: Optional[List[int]] = None,
    ) -> Dict[str, Any]:
        """Odoslanie print príkazu cez MQTT."""
        try:
            import paho.mqtt.client as mqtt
        except ImportError:
            return {
                "success": False,
                "error": "paho-mqtt nie je nainštalovaný. pip install paho-mqtt",
            }
        
        try:
            # Bambu Lab MQTT správa pre spustenie tlače
            print_command = {
                "print": {
                    "sequence_id": str(int(time.time())),
                    "command": "project_file",
                    "param": f"Metadata/plate_1.gcode",
                    "subtask_name": filename.replace(".3mf", ""),
                    "url": f"ftp://{filename}",
                    "bed_leveling": bed_leveling,
                    "flow_cali": False,
                    "vibration_cali": False,
                    "layer_inspect": False,
                    "use_ams": ams_mapping is not None,
                    "ams_mapping": ams_mapping or [],
                    "profile_id": "0",
                    "project_id": "0",
                    "subtask_id": "0",
                    "task_id": "0",
                }
            }
            
            client = mqtt.Client(
                client_id=f"adsun_configurator_{uuid.uuid4().hex[:8]}",
                protocol=mqtt.MQTTv311,
            )
            
            # TLS nastavenie
            client.tls_set(cert_reqs=ssl.CERT_NONE)
            client.tls_insecure_set(True)
            
            # Autentifikácia
            client.username_pw_set("bblp", self.printer.access_code)
            
            # Pripojiť
            client.connect(self.printer.ip, 8883, keepalive=10)
            
            # Odoslať príkaz
            topic = self.printer.mqtt_topic_publish
            payload = json.dumps(print_command)
            
            result = client.publish(topic, payload, qos=1)
            result.wait_for_publish(timeout=10)
            
            client.disconnect()
            
            logger.info(f"MQTT print command odoslaný na {self.printer.ip}")
            return {"success": True}
            
        except Exception as e:
            logger.error(f"MQTT chyba: {e}")
            return {"success": False, "error": f"MQTT chyba: {str(e)}"}
    
    def get_status(self) -> Dict[str, Any]:
        """Získať aktuálny stav tlačiarne cez MQTT."""
        try:
            import paho.mqtt.client as mqtt
        except ImportError:
            return {"success": False, "error": "paho-mqtt nie je nainštalovaný"}
        
        status_received = {"data": None}
        
        def on_message(client, userdata, msg):
            try:
                status_received["data"] = json.loads(msg.payload)
            except json.JSONDecodeError:
                pass
        
        try:
            client = mqtt.Client(
                client_id=f"adsun_status_{uuid.uuid4().hex[:8]}",
                protocol=mqtt.MQTTv311,
            )
            
            client.tls_set(cert_reqs=ssl.CERT_NONE)
            client.tls_insecure_set(True)
            client.username_pw_set("bblp", self.printer.access_code)
            client.on_message = on_message
            
            client.connect(self.printer.ip, 8883, keepalive=10)
            client.subscribe(self.printer.mqtt_topic_subscribe, qos=1)
            
            # Požiadať o stav
            push_cmd = {
                "pushing": {
                    "sequence_id": str(int(time.time())),
                    "command": "pushall",
                }
            }
            client.publish(
                self.printer.mqtt_topic_publish,
                json.dumps(push_cmd),
                qos=1,
            )
            
            # Počkať na odpoveď (max 5s)
            deadline = time.time() + 5
            client.loop_start()
            while time.time() < deadline and status_received["data"] is None:
                time.sleep(0.1)
            client.loop_stop()
            client.disconnect()
            
            if status_received["data"]:
                return self._parse_status(status_received["data"])
            else:
                return {"success": False, "error": "Timeout – tlačiareň neodpovedala"}
                
        except Exception as e:
            return {"success": False, "error": f"Chyba spojenia: {str(e)}"}
    
    def _parse_status(self, raw: Dict) -> Dict[str, Any]:
        """Parsuje raw MQTT status na prehľadný formát."""
        print_data = raw.get("print", {})
        
        # Stav tlače
        gcode_state = print_data.get("gcode_state", "UNKNOWN")
        state_map = {
            "IDLE": "idle",
            "PREPARE": "preparing",
            "RUNNING": "printing",
            "PAUSE": "paused",
            "FINISH": "finished",
            "FAILED": "failed",
        }
        
        return {
            "success": True,
            "state": state_map.get(gcode_state, gcode_state.lower()),
            "progress": print_data.get("mc_percent", 0),
            "remaining_minutes": print_data.get("mc_remaining_time", 0),
            "current_layer": print_data.get("layer_num", 0),
            "total_layers": print_data.get("total_layer_num", 0),
            "nozzle_temp": print_data.get("nozzle_temper", 0),
            "bed_temp": print_data.get("bed_temper", 0),
            "chamber_temp": print_data.get("chamber_temper", 0),
            "fan_speed": print_data.get("cooling_fan_speed", 0),
            "subtask_name": print_data.get("subtask_name", ""),
            "wifi_signal": print_data.get("wifi_signal", ""),
        }


# ─────────────────────────────────────────────
# Helper: Konverzia STL ZIP → 3MF
# ─────────────────────────────────────────────

def convert_stl_zip_to_3mf(
    zip_path: str,
    output_3mf_path: str,
    project_name: str = "ADSUN Sign",
    material: str = "ASA",
    printer_model: str = "x1c",
    print_settings: Optional[Dict[str, Any]] = None,
) -> str:
    """
    Konvertuje ZIP so STL súbormi na .3MF balík.
    
    Rozbalí ZIP, nájde všetky .stl súbory a zabalí ich do .3mf.
    """
    import tempfile
    
    temp_dir = tempfile.mkdtemp(prefix="adsun_3mf_")
    stl_files = []
    
    try:
        # Rozbaliť ZIP
        with zipfile.ZipFile(zip_path, 'r') as zf:
            for name in zf.namelist():
                if name.lower().endswith('.stl'):
                    extracted = zf.extract(name, temp_dir)
                    stl_files.append(extracted)
        
        if not stl_files:
            raise ValueError("ZIP neobsahuje žiadne STL súbory")
        
        # Vygenerovať .3mf
        return generate_3mf(
            stl_files=stl_files,
            output_path=output_3mf_path,
            project_name=project_name,
            material=material,
            printer_model=printer_model,
            print_settings=print_settings,
        )
    finally:
        # Cleanup
        import shutil
        shutil.rmtree(temp_dir, ignore_errors=True)
