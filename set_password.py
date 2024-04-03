import bcrypt
import getpass  # Used for secure password input
import os
import folder_paths
comfy_dir = os.path.dirname(folder_paths.__file__)
password_path = os.path.join(comfy_dir, "PASSWORD")

def main():
    # Prompt the user for a new password securely
    password = getpass.getpass('Enter a new password: ')
    # Prompt for the password again for verification
    password_verify = getpass.getpass('Re-enter your password: ')

    # Check if both entered passwords match
    if password == password_verify:
        # Convert the password to bytes
        password_bytes = password.encode('utf-8')

        # Generate a salt and hash the password
        salt = bcrypt.gensalt()
        hashed_password = bcrypt.hashpw(password_bytes, salt)

        # Write the hashed password to a file
        with open(password_path, "wb") as file:
            file.write(hashed_password)
        
        print("Password has been securely stored. Now you can restart ComfyUI.")
    else:
        print("Passwords do not match. Please try again.")

if __name__ == "__main__":
    main()
