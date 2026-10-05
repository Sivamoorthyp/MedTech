import csv
import random
import os

DATASET_PATH = r"e:\siva projects hack\biometrics_dataset.csv"

def get_user_vitals(user_identifier=None):
    vitals = {
        'heartrate': 'Unknown',
        'bp': 'Unknown',
        'stress': 'Unknown',
        'hrv': 'Unknown'
    }
    
    if not os.path.exists(DATASET_PATH):
        print(f"Dataset not found at {DATASET_PATH}")
        return vitals

    try:
        with open(DATASET_PATH, mode='r', encoding='utf-8', errors='ignore') as f:
            reader = csv.DictReader(f)
            rows = list(reader)
            
            if not rows:
                return vitals
                
            selected_row = random.choice(rows)
            
            if user_identifier:
                for row in rows:
                    if row.get('user_id') == user_identifier:
                        selected_row = row
                        break
                        
            vitals['heartrate'] = selected_row.get('heartrate', 'Unknown')
            vitals['bp'] = selected_row.get('bp', 'Unknown')
            vitals['stress'] = selected_row.get('stress', 'Unknown')
            vitals['hrv'] = selected_row.get('hrv', 'Unknown')
            
    except Exception as e:
        print(f"Error reading dataset: {e}")
        
    return vitals
